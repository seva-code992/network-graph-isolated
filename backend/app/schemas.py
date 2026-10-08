from __future__ import annotations

from pydantic import BaseModel, Field


class GeneIn(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^\S+$")
    description: str = Field(default="", max_length=2000)


class TsvIn(BaseModel):
    filename: str = Field(default="", max_length=255)
    text: str


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    species: str
    description: str = Field(default="", max_length=2000)
    genes: list[GeneIn] = Field(min_length=1, max_length=50_000)


class ListSelection(BaseModel):
    id: str
    # None -> every gene of the list
    gene_ids: list[str] | None = None


class GraphIn(BaseModel):
    lists: list[ListSelection] = Field(min_length=1, max_length=12)
    experiment_ids: list[str] = Field(default_factory=list, max_length=50)
    edges_per_node: int | None = Field(default=None, ge=1, le=10)
