"""Gene-list storage. Stand-in for the mother API, which owns the real lists.

`ListsProvider` is the seam to replace when integrating: list_lists / get_list / save_list.
"""
from __future__ import annotations

import json
import os
import random
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Protocol

from .embeddings import EmbeddingStore
from .species import SPECIES


class ListsProvider(Protocol):
    def list_lists(self) -> list[dict]: ...
    def get_list(self, list_id: str) -> dict | None: ...
    def save_list(self, name: str, species: str, description: str, genes: list[dict]) -> dict: ...


_DEMO = [
    ("Drought-response TFs in Pinus sylvestris", "pinsy"),
    ("Cold resistance in Pinus sylvestris", "pinsy"),
    ("Cold resistance in Populus tremula", "potra"),
]
_DESCRIPTIONS = [
    "MYB domain transcription factor, putative drought-responsive regulator.",
    "Dehydration-responsive element binding protein DREB2A. Key regulator of abiotic stress.",
    "NAC domain containing protein 19. Membrane-associated transcription factor.",
    "bZIP transcription factor. Abscisic acid signaling component.",
    "WRKY transcription factor involved in cold acclimation.",
    "Late embryogenesis abundant protein, dehydration tolerance.",
    "Heat shock protein 70 family chaperone.",
    "Cold-regulated protein COR15, stabilises membranes during freezing.",
]


def summary(lst: dict) -> dict:
    return {k: lst[k] for k in ("id", "name", "description", "species")} | {"n_genes": len(lst["genes"])}


class FileListsProvider:
    def __init__(self, path: Path, store: EmbeddingStore, seed_demo: bool):
        self.path = Path(path)
        self._lock = threading.Lock()
        if not self.path.exists():
            self._write(self._demo_lists(store) if seed_demo else [])

    def _demo_lists(self, store: EmbeddingStore, n: int = 40) -> list[dict]:
        lists = []
        for i, (name, species) in enumerate(_DEMO):
            if not store.available(species):
                continue
            ids = store.gene_ids(species)
            rng = random.Random(i)
            picked = rng.sample(ids, min(n, len(ids)))
            lists.append({
                "id": f"demo{i + 1}", "name": name, "species": species, "source": "demo",
                "description": "Demo list generated from the embedding gene IDs.",
                "genes": [{"id": g, "description": rng.choice(_DESCRIPTIONS)} for g in picked],
            })
        return lists

    def _read(self) -> list[dict]:
        return json.loads(self.path.read_text())

    def _write(self, lists: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(lists, f)
        os.replace(tmp, self.path)

    def list_lists(self) -> list[dict]:
        return [summary(l) for l in self._read()]

    def get_list(self, list_id: str) -> dict | None:
        return next((l for l in self._read() if l["id"] == list_id), None)

    def save_list(self, name, species, description, genes) -> dict:
        assert species in SPECIES
        lst = {"id": uuid.uuid4().hex[:12], "name": name, "species": species,
               "description": description, "source": "user", "genes": genes}
        with self._lock:
            self._write(self._read() + [lst])
        return lst
