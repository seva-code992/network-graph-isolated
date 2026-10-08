"""Expression-experiment sources.

The real source is the Neo4j database. Its schema is not wired up yet, so for now the mock source
provides a fixed list of experiments plus deterministic pseudo expression scores. Add the
Neo4j-backed implementation of `ExperimentSource` and select it with EXPERIMENT_SOURCE=neo4j.
"""
from __future__ import annotations

import zlib
from typing import Protocol

import numpy as np

from .similarity import knn_edges, prune_topk


class ExperimentSource(Protocol):
    def list_experiments(self) -> list[dict]: ...

    def expression_edges(
        self, experiment_ids: list[str], genes: list[tuple[str, str]], k: int
    ) -> dict[tuple[str, str], float]:
        """genes = [(gene_id, species)]. Returns {(gene_a, gene_b): score in (0, 1]} for
        same-species pairs, taking the best score across the selected experiments."""
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

    def expression_edges(self, experiment_ids, genes, k):
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
            pairs = knn_edges(self._vectors(exp, ids), labels, k, same_label=True)
            for (i, j), s in pairs.items():
                key = (ids[i], ids[j])
                out[key] = max(out.get(key, 0.0), round(s, 4))
        return prune_topk(out, k) if len(experiment_ids) > 1 else out


def make_source(kind: str) -> ExperimentSource:
    if kind == "mock":
        return MockExperimentSource()
    raise NotImplementedError(
        f"EXPERIMENT_SOURCE={kind!r}: the Neo4j experiment source is not implemented yet"
    )
