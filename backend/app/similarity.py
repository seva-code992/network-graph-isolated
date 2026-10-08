"""Edge construction. Both edge types keep only each gene's top-k partners so the number of
edges stays proportional to the number of nodes (readable graph, no hairball)."""
from __future__ import annotations

import numpy as np


def knn_edges(
    X: np.ndarray, labels: np.ndarray, k: int, same_label: bool, chunk: int = 512
) -> dict[tuple[int, int], float]:
    """Top-k cosine neighbours per row of an L2-normalised matrix X.

    same_label=False -> only pairs with different labels (annotation edges, cross-species)
    same_label=True  -> only pairs with equal labels (expression edges, same species)
    Returns {(i, j): score} with i < j and 0 < score <= 1.
    """
    n = len(X)
    out: dict[tuple[int, int], float] = {}
    if n < 2 or k < 1:
        return out
    kk = min(k, n)
    for start in range(0, n, chunk):
        rows = np.arange(start, min(start + chunk, n))
        scores = X[rows] @ X.T
        eq = labels[rows, None] == labels[None, :]
        allowed = eq if same_label else ~eq
        allowed[np.arange(len(rows)), rows] = False
        scores = np.where(allowed, scores, -np.inf)
        top = np.argpartition(-scores, kk - 1, axis=1)[:, :kk]
        for r, i in enumerate(rows):
            for j in top[r]:
                s = float(scores[r, j])
                if np.isfinite(s) and s > 0:
                    key = (int(min(i, j)), int(max(i, j)))
                    out[key] = max(out.get(key, 0.0), min(s, 1.0))
    return out


def prune_topk(pairs: dict[tuple, float], k: int) -> dict[tuple, float]:
    """Keep an edge only if it is among the k strongest edges of at least one of its endpoints.
    Used after merging several experiments so the edge count stays ~ k x nodes."""
    by_node: dict = {}
    for (a, b), s in pairs.items():
        by_node.setdefault(a, []).append((s, (a, b)))
        by_node.setdefault(b, []).append((s, (a, b)))
    keep = set()
    for edges in by_node.values():
        edges.sort(key=lambda t: (-t[0], t[1]))
        keep.update(key for _, key in edges[:k])
    return {key: pairs[key] for key in keep}
