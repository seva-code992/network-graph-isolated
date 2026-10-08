from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Species:
    code: str
    name: str
    # Prefix of the embedding files: <prefix>-embeddings.npy / <prefix>-gene-ids.npy
    file_prefix: str


SPECIES: dict[str, Species] = {
    s.code: s
    for s in (
        Species("arath", "Arabidopsis thaliana", "arabidopsis"),
        Species("pruav", "Prunus avium", "pruav"),
        Species("pinsy", "Pinus sylvestris", "pinsy"),
        Species("picab", "Picea abies", "picab"),
        Species("potra", "Populus tremula", "potra"),
        Species("betpe", "Betula pendula", "betpe"),
    )
}
