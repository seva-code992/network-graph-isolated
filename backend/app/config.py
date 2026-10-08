"""Runtime configuration, read from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    # Directory holding <species>-embeddings.npy / <species>-gene-ids.npy
    embeddings_dir: Path = Path("/data/embeddings")
    # Writable directory for lists imported by users (stand-in for the mother API)
    data_dir: Path = Path("/data/app")
    # Built frontend (served at "/" when present)
    frontend_dist: Path = Path("/app/frontend-dist")
    # "mock" for now; "neo4j" is reserved for when the experiment schema is wired up
    experiment_source: str = "mock"
    # Seed demo gene lists (sampled from the embedding gene-id files) on first start
    seed_demo_lists: bool = True
    # Safety cap on the number of edges one graph may contain (every possible edge is returned)
    max_edges: int = 100_000

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ
        return cls(
            embeddings_dir=Path(e.get("EMBEDDINGS_DIR", cls.embeddings_dir)),
            data_dir=Path(e.get("DATA_DIR", cls.data_dir)),
            frontend_dist=Path(e.get("FRONTEND_DIST", cls.frontend_dist)),
            experiment_source=e.get("EXPERIMENT_SOURCE", cls.experiment_source),
            seed_demo_lists=e.get("SEED_DEMO_LISTS", "1") not in ("0", "false", "False"),
            max_edges=int(e.get("MAX_EDGES", cls.max_edges)),
        )
