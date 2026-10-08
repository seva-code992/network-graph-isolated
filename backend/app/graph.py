"""Assemble the network graph (nodes + all annotation edges + all expression edges) for a selection."""
from __future__ import annotations

import numpy as np

from .embeddings import EmbeddingStore
from .experiments import ExperimentSource
from .similarity import TooManyEdges, pair_edges


def build_graph(selection: list[tuple[dict, list[dict]]], store: EmbeddingStore,
                experiments: ExperimentSource, experiment_ids: list[str], max_edges: int) -> dict:
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
        for (i, j), s in pair_edges(X, np.array(labels), same_label=False, limit=max_edges).items():
            edges.append({"source": owners[i], "target": owners[j], "type": "annotation",
                          "score": round(s, 4)})
    elif len(dims) > 1:
        raise ValueError("Embeddings of the selected species have different dimensions")

    # --- expression edges: same species only, from the selected experiments ---
    if experiment_ids:
        pairs = experiments.expression_edges(
            experiment_ids, [(n["id"], n["species"]) for n in nodes.values()], max_edges)
        edges += [{"source": a, "target": b, "type": "expression", "score": s}
                  for (a, b), s in pairs.items()]

    if len(edges) > max_edges:
        raise TooManyEdges(f"The selection produces {len(edges)} edges (limit {max_edges}). Select fewer genes.")
    return {"lists": lists_out, "nodes": list(nodes.values()), "edges": edges, "missing": missing}


def shared_genes(selection: list[tuple[dict, list[dict]]]) -> list[dict]:
    """Genes that occur (among the selected genes) in more than one of the selected lists."""
    seen: dict[str, list[dict]] = {}
    for lst, genes in selection:
        for g in genes:
            owners = seen.setdefault(g["id"], [])
            if all(o["id"] != lst["id"] for o in owners):
                owners.append({"id": lst["id"], "name": lst["name"]})
    return [{"id": gid, "lists": owners} for gid, owners in seen.items() if len(owners) > 1]
