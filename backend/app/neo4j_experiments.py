"""Experiment source backed by the PlantGenie Neo4j database (the one the heatmap reads).

Same schema as plantgenie-api's `api/v2/expression/routes.py`:
  (:Annotation)-[:HAS_EXPERIMENT]->(:Experiment)<-[:PART_OF]-(:Sample)<-[:EXPRESSED_IN {value}]-(:Gene)
Edges come from the same stored values as the heatmap (`EXPRESSED_IN`), for every experiment alike: the score
of two genes is the Pearson correlation of their heatmap rows (see `coexpression.py`). The precomputed
`COEXPRESSED_WITH` edges are deliberately not used - the heatmap does not read them, and only some
experiments have them.
Annotation ids start with the species code ('picab-v2.0'), which tells which species an experiment is for.
"""
from __future__ import annotations

from .coexpression import expression_pairs
from .similarity import TooManyEdges
from .species import SPECIES

LIST_QUERY = (
    "MATCH (a:Annotation)-[:HAS_EXPERIMENT]->(e:Experiment) "
    "RETURN a.id AS annotation, e.id AS id, e.name AS name, e.description AS description "
    "ORDER BY e.name"
)
# one row per (gene, sample): the heatmap's matrix, in the heatmap's sample order
EXPRESSION_QUERY = (
    "MATCH (e:Experiment {id: $experimentId})<-[:PART_OF]-(s:Sample) "
    "WITH s ORDER BY s.order "
    "WITH collect(s) AS samples "
    "UNWIND $geneIds AS geneId "
    "MATCH (g:Gene {id: geneId}) "
    "UNWIND samples AS sample "
    "OPTIONAL MATCH (g)-[r:EXPRESSED_IN]->(sample) "
    "RETURN geneId, r.value AS value"
)

class Neo4jExperimentSource:
    def __init__(self, uri: str, user: str, password: str, driver=None):
        if driver is None:
            from neo4j import GraphDatabase  # imported lazily: the mock source needs no driver
            driver = GraphDatabase.driver(uri, auth=(user, password))
        self._driver = driver
        self._species: dict[str, str] = {}   # experiment id -> species code

    def list_experiments(self) -> list[dict]:
        records, _, _ = self._driver.execute_query(LIST_QUERY)
        out = []
        for r in records:
            species = r["annotation"].split("-", 1)[0]
            if species not in SPECIES:
                continue
            self._species[r["id"]] = species
            out.append({"id": r["id"], "name": r["name"] or r["id"], "species": species,
                        "description": r["description"] or ""})
        return out

    def _profiles(self, experiment_id: str, gene_ids: list[str]) -> tuple[list[str], list[list]]:
        records, _, _ = self._driver.execute_query(EXPRESSION_QUERY, experimentId=experiment_id, geneIds=gene_ids)
        by_gene: dict[str, list] = {}
        for r in records:
            by_gene.setdefault(r["geneId"], []).append(r["value"])
        ids = [g for g in gene_ids if g in by_gene and any(v is not None for v in by_gene[g])]
        return ids, [by_gene[g] for g in ids]

    def expression_edges(self, experiment_ids, genes, limit=None):
        if not self._species:
            self.list_experiments()
        out: dict[tuple[str, str], float] = {}
        for exp in experiment_ids:
            species = self._species.get(exp)
            if species is None:
                raise KeyError(exp)
            ids, rows = self._profiles(exp, [g for g, s in genes if s == species])
            for key, score in expression_pairs(ids, rows, limit).items():
                out[key] = max(out.get(key, 0.0), score)
            if limit is not None and len(out) > limit:
                raise TooManyEdges(f"The selection produces more than {limit} edges. Select fewer genes.")
        return out
