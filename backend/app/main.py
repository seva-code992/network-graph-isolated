from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import tsv
from .config import Settings
from .embeddings import EmbeddingStore
from .experiments import make_source
from .graph import build_graph, shared_genes
from .lists import FileListsProvider, summary
from .schemas import GraphIn, ListIn, SharedIn, TsvIn
from .species import SPECIES


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = EmbeddingStore(settings.embeddings_dir)
    lists = FileListsProvider(settings.data_dir / "lists.json", store, settings.seed_demo_lists)
    experiments = make_source(settings.experiment_source)
    app = FastAPI(title="Network graph API")
    app.state.store = store

    @app.get("/api/health")
    def health():
        return {"ok": True, "species_with_embeddings": [s for s in SPECIES if store.available(s)]}

    @app.get("/api/species")
    def species():
        return [{"code": s.code, "name": s.name, "has_embeddings": store.available(s.code)}
                for s in SPECIES.values()]

    @app.get("/api/experiments")
    def list_experiments():
        return experiments.list_experiments()

    @app.get("/api/lists")
    def list_lists():
        return lists.list_lists()

    @app.get("/api/lists/{list_id}")
    def get_list(list_id: str):
        lst = lists.get_list(list_id)
        if lst is None:
            raise HTTPException(404, "List not found")
        return lst

    @app.post("/api/lists/parse-tsv")
    def parse_tsv(body: TsvIn):
        name = body.filename.lower()
        if name and not name.endswith((".tsv", ".tab", ".txt")):
            raise HTTPException(422, "Please provide a .tsv file.")
        try:
            parsed = tsv.parse_tsv(body.text)
        except tsv.TsvFormatError as e:
            raise HTTPException(422, str(e)) from e
        return {"genes": parsed.genes, "warnings": parsed.warnings}

    @app.post("/api/lists", status_code=201)
    def create_list(body: ListIn):
        if body.species not in SPECIES:
            raise HTTPException(422, f"Unknown species {body.species!r}")
        if len({g.id for g in body.genes}) != len(body.genes):
            raise HTTPException(422, "Duplicate gene IDs")
        saved = lists.save_list(body.name.strip(), body.species, body.description.strip(),
                                [g.model_dump() for g in body.genes])
        return summary(saved)

    def resolve(sel_in) -> list[tuple[dict, list[dict]]]:
        selection = []
        for sel in sel_in:
            lst = lists.get_list(sel.id)
            if lst is None:
                raise HTTPException(404, f"List {sel.id!r} not found")
            genes = lst["genes"]
            if sel.gene_ids is not None:
                wanted = set(sel.gene_ids)
                genes = [g for g in genes if g["id"] in wanted]
            if genes:
                selection.append((lst, genes))
        if not selection:
            raise HTTPException(422, "No genes selected")
        return selection

    @app.post("/api/graph/shared-genes")
    def graph_shared_genes(body: SharedIn):
        return {"genes": shared_genes(resolve(body.lists))}

    @app.post("/api/graph")
    def graph(body: GraphIn):
        selection = resolve(body.lists)
        try:
            return build_graph(selection, store, experiments, body.experiment_ids, settings.max_edges)
        except KeyError as e:
            raise HTTPException(422, f"Unknown experiment {e.args[0]!r}") from e
        except ValueError as e:  # includes TooManyEdges
            raise HTTPException(422, str(e)) from e

    dist = Path(settings.frontend_dist)
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


