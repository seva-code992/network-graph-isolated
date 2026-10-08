"""Lazy access to the per-species annotation embeddings stored as .npy files."""
from __future__ import annotations

import logging
import threading
from pathlib import Path

import numpy as np

from .species import SPECIES

log = logging.getLogger(__name__)


def _load_ids(path: Path) -> list[str]:
    try:
        arr = np.load(path, allow_pickle=False)
    except ValueError:
        # object arrays (e.g. python str lists) need pickle; these files are operator-supplied
        log.warning("%s needs allow_pickle; loading it as a trusted file", path.name)
        arr = np.load(path, allow_pickle=True)
    return [i.decode() if isinstance(i, bytes) else str(i) for i in arr.ravel().tolist()]


class EmbeddingStore:
    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self._index: dict[str, dict[str, int]] = {}
        self._matrix: dict[str, np.ndarray] = {}
        self._lock = threading.Lock()

    def _paths(self, species: str) -> tuple[Path, Path]:
        p = SPECIES[species].file_prefix
        return self.dir / f"{p}-embeddings.npy", self.dir / f"{p}-gene-ids.npy"

    def available(self, species: str) -> bool:
        return all(p.is_file() for p in self._paths(species))

    def gene_ids(self, species: str) -> list[str]:
        self._load(species)
        return list(self._index[species])

    def _load(self, species: str) -> None:
        with self._lock:
            if species in self._index:
                return
            emb_path, ids_path = self._paths(species)
            ids = _load_ids(ids_path)
            matrix = np.load(emb_path, mmap_mode="r")  # big files: only touch requested rows
            if matrix.ndim != 2 or matrix.shape[0] != len(ids):
                raise ValueError(
                    f"{emb_path.name}: shape {matrix.shape} does not match "
                    f"{len(ids)} ids in {ids_path.name}"
                )
            self._index[species] = {g: i for i, g in enumerate(ids)}
            self._matrix[species] = matrix

    def get(self, species: str, gene_ids: list[str]) -> tuple[list[str], np.ndarray]:
        """Return (found ids, L2-normalised float32 matrix) for the genes that have an embedding."""
        if not self.available(species):
            return [], np.zeros((0, 0), dtype=np.float32)
        self._load(species)
        index = self._index[species]
        found = [g for g in gene_ids if g in index]
        if not found:
            return [], np.zeros((0, self._matrix[species].shape[1]), dtype=np.float32)
        rows = np.fromiter((index[g] for g in found), dtype=np.int64)
        order = np.argsort(rows)
        block = np.empty((len(rows), self._matrix[species].shape[1]), dtype=np.float32)
        block[order] = np.asarray(self._matrix[species][rows[order]], dtype=np.float32)
        norms = np.linalg.norm(block, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return found, block / norms
