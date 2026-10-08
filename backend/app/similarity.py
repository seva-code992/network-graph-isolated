"""Edge construction: every possible pair of the relevant kind with a positive score."""
from __future__ import annotations

import numpy as np


class TooManyEdges(ValueError):
    pass


def pair_edges(X: np.ndarray, labels: np.ndarray, same_label: bool,
               limit: int | None = None, chunk: int = 512) -> dict[tuple[int, int], float]:
    """All pairs (i < j) of an L2-normalised matrix X with cosine score > 0 (scores capped at 1).

    same_label=False -> only pairs with different labels (annotation edges, cross-species)
    same_label=True  -> only pairs with equal labels (expression edges, same species)
    Raises TooManyEdges as soon as more than `limit` pairs are found.
    """
    n = len(X)
    out: dict[tuple[int, int], float] = {}
    cols = np.arange(n)
    for start in range(0, n, chunk):
        rows = np.arange(start, min(start + chunk, n))
        scores = X[rows] @ X.T
        eq = labels[rows, None] == labels[None, :]
        ok = (eq if same_label else ~eq) & (cols[None, :] > rows[:, None]) & (scores > 0)
        ii, jj = np.nonzero(ok)
        if limit is not None and len(out) + len(ii) > limit:
            raise TooManyEdges(
                f"The selection produces more than {limit} edges. Select fewer genes "
                "(or raise MAX_EDGES on the server).")
        for i, j in zip(ii.tolist(), jj.tolist()):
            out[(int(rows[i]), j)] = min(float(scores[i, j]), 1.0)
    return out
