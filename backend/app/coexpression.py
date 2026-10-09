"""Expression profiles -> expression edges.

The heatmap shows a genes x samples matrix. Two genes are "connected" in the network graph when their
rows of that matrix move together: the score is the Pearson correlation across the experiment's samples
(negative correlations get no edge, as for annotation edges). Centring each row and scaling it to unit
length turns Pearson into a plain dot product, so `similarity.pair_edges` does the pair search.
"""
from __future__ import annotations

import numpy as np

from .similarity import pair_edges


def profile_matrix(rows: list[list[float | None]]) -> np.ndarray:
    """Rows of heatmap values (None = no measurement) -> centred, unit-length rows.
    Missing values become the gene's mean; a gene with a flat profile becomes all zeros (no edges)."""
    X = np.array([[np.nan if v is None else v for v in r] for r in rows], dtype=np.float64)
    if X.size == 0:
        return X.astype(np.float32)
    means = np.nanmean(np.where(np.isnan(X).all(axis=1, keepdims=True), 0.0, X), axis=1, keepdims=True)
    X = np.where(np.isnan(X), means, X) - means
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    return np.divide(X, norms, out=np.zeros_like(X), where=norms > 1e-12).astype(np.float32)


def expression_pairs(gene_ids: list[str], rows: list[list[float | None]],
                     limit: int | None = None) -> dict[tuple[str, str], float]:
    """{(gene_a, gene_b): correlation in (0, 1]} for every pair of genes of one experiment."""
    if len(gene_ids) < 2:
        return {}
    pairs = pair_edges(profile_matrix(rows), np.zeros(len(gene_ids), dtype=int), same_label=True, limit=limit)
    return {(gene_ids[i], gene_ids[j]): round(s, 4) for (i, j), s in pairs.items()}
