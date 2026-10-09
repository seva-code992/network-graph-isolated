"""Expression-experiment sources.

`neo4j_experiments.Neo4jExperimentSource` reads the real experiments (EXPERIMENT_SOURCE=neo4j, the same
list and expression values the heatmap uses). The mock source provides a fixed list of experiments plus
deterministic pseudo scores, for development and tests without a database.
"""
from __future__ import annotations

import zlib
from typing import Protocol

import numpy as np

from .similarity import TooManyEdges, pair_edges


class ExperimentSource(Protocol):
    def list_experiments(self) -> list[dict]: ...

    def expression_edges(
        self, experiment_ids: list[str], genes: list[tuple[str, str]], limit: int | None = None
    ) -> dict[tuple[str, str], float]:
        """genes = [(gene_id, species)]. Returns {(gene_a, gene_b): score in (0, 1]} for
        every same-species pair with a score, taking the best score across the selected experiments."""
        ...


class MockExperimentSource:
    N = 5
    DIM = 8

    def list_experiments(self) -> list[dict]:
        return [
            {"id": f"experiment{i}", "name": f"experiment{i}",
             "description": f"Mock expression experiment {i}"}
            for i in range(1, self.N + 1)
        ]

    def _vectors(self, exp: str, gene_ids: list[str]) -> np.ndarray:
        # per-gene random profile seeded by (experiment, gene) -> stable between requests
        X = np.stack([
            np.random.default_rng(zlib.crc32(f"{exp}:{g}".encode())).standard_normal(self.DIM)
            for g in gene_ids
        ]).astype(np.float32)
        return X / np.linalg.norm(X, axis=1, keepdims=True)

    def expression_edges(self, experiment_ids, genes, limit=None):
        known = {e["id"] for e in self.list_experiments()}
        out: dict[tuple[str, str], float] = {}
        if not genes:
            return out
        ids = [g for g, _ in genes]
        codes = {s: i for i, s in enumerate(sorted({s for _, s in genes}))}
        labels = np.array([codes[s] for _, s in genes])
        for exp in experiment_ids:
            if exp not in known:
                raise KeyError(exp)
            pairs = pair_edges(self._vectors(exp, ids), labels, same_label=True, limit=limit)
            for (i, j), s in pairs.items():
                key = (ids[i], ids[j])
                out[key] = max(out.get(key, 0.0), round(s, 4))
        if limit is not None and len(out) > limit:
            raise TooManyEdges(f"The selection produces more than {limit} edges. Select fewer genes.")
        return out


def make_source(kind: str, settings=None) -> ExperimentSource:
    if kind == "mock":
        return MockExperimentSource()
    if kind == "neo4j":
        from .neo4j_experiments import Neo4jExperimentSource
        return Neo4jExperimentSource(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    raise ValueError(f"Unknown EXPERIMENT_SOURCE {kind!r} (use 'mock' or 'neo4j')")
