"""Assemble the network graph (nodes + annotation edges + expression edges) for a selection."""
from __future__ import annotations

import numpy as np

from .embeddings import EmbeddingStore
from .experiments import ExperimentSource
from .similarity import knn_edges


def build_graph(selection: list[tuple[dict, list[dict]]], store: EmbeddingStore,
                experiments: ExperimentSource, experiment_ids: list[str], k: int) -> dict:
    """selection = [(list, selected genes)] in the order the user picked them."""
    nodes: dict[str, dict] = {}
    lists_out = []
    for lst, genes in selection:
        lists_out.append({"id": lst["id"], "name": lst["name"], "species": lst["species"],
                          "n_genes": len(genes)})
        for g in genes:
            node = nodes.get(g["id"])
            if node is None:
                nodes[g["id"]] = {"id": g["id"], "species": lst["species"],
                                  "lists": [lst["id"]], "description": g["description"]}
            elif lst["id"] not in node["lists"]:
                node["lists"].append(lst["id"])

    # --- annotation edges: cosine similarity of embeddings, genes of different species ---
    vectors, owners, labels = [], [], []
    missing = []
    species_codes: dict[str, int] = {}
    by_species: dict[str, list[str]] = {}
    for n in nodes.values():
        by_species.setdefault(n["species"], []).append(n["id"])
    dims = set()
    for sp, ids in by_species.items():
        found, mat = store.get(sp, ids)
        found_set = set(found)
        missing += [{"gene_id": i, "species": sp} for i in ids if i not in found_set]
        if len(found):
            dims.add(mat.shape[1])
            species_codes.setdefault(sp, len(species_codes))
            vectors.append(mat)
            owners += found
            labels += [species_codes[sp]] * len(found)
    edges = []
    if len(dims) == 1 and len(species_codes) > 1:
        X = np.vstack(vectors)
        for (i, j), s in knn_edges(X, np.array(labels), k, same_label=False).items():
            edges.append({"source": owners[i], "target": owners[j], "type": "annotation",
                          "score": round(s, 4)})
    elif len(dims) > 1:
        raise ValueError("Embeddings of the selected species have different dimensions")

    # --- expression edges: same species only, from the selected experiments ---
    if experiment_ids:
        pairs = experiments.expression_edges(
            experiment_ids, [(n["id"], n["species"]) for n in nodes.values()], k)
        edges += [{"source": a, "target": b, "type": "expression", "score": s}
                  for (a, b), s in pairs.items()]

    return {"lists": lists_out, "nodes": list(nodes.values()), "edges": edges, "missing": missing}
