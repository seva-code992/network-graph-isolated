"""Write small synthetic <species>-embeddings.npy / -gene-ids.npy files for local development
and tests. Genes of different species share a latent "function" so cross-species cosine
similarity is meaningful. Usage: python scripts/make_fixture_embeddings.py OUT_DIR [N]"""
import sys
from pathlib import Path

import numpy as np

PREFIX = {"arath": ("arabidopsis", "AT{}G{:05d}"), "pruav": ("pruav", "PRUAV_G{1:06d}"),
          "pinsy": ("pinsy", "PSYL_G{1:06d}"), "picab": ("picab", "MA_{1:06d}g0010"),
          "potra": ("potra", "Potra{1:06d}"), "betpe": ("betpe", "Bpev01.c{1:04d}")}


def main(out: Path, n: int = 300, dim: int = 64) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    functions = rng.standard_normal((20, dim))
    for sp, (prefix, fmt) in PREFIX.items():
        ids = [fmt.format(1 + i % 5, i + 1) for i in range(n)]
        func = rng.integers(0, len(functions), n)
        emb = functions[func] + 0.7 * rng.standard_normal((n, dim))
        np.save(out / f"{prefix}-embeddings.npy", emb.astype(np.float32))
        np.save(out / f"{prefix}-gene-ids.npy", np.array(ids))
    print(f"wrote fixtures for {len(PREFIX)} species to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 300)
