"""Parsing and validation of user-imported gene lists (.tsv: gene ID <TAB> description)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_BYTES = 5 * 1024 * 1024
MAX_GENES = 50_000
_HEADER = re.compile(r"^(gene[_ ]?ids?|genes?|ids?)$", re.I)
_GENE_ID = re.compile(r"^\S{1,64}$")


class TsvFormatError(ValueError):
    """The uploaded file is not a valid two-column gene list."""


@dataclass
class ParsedList:
    genes: list[dict[str, str]]
    warnings: list[str] = field(default_factory=list)


def parse_tsv(text: str) -> ParsedList:
    if len(text.encode("utf-8", "ignore")) > MAX_BYTES:
        raise TsvFormatError("The file is too large (limit 5 MB).")
    if "\x00" in text:
        raise TsvFormatError("The file is not a text file. Please provide a .tsv file.")
    text = text.lstrip("﻿")

    rows = [(n, line) for n, line in enumerate(text.splitlines(), 1) if line.strip()]
    if not rows:
        raise TsvFormatError("The file is empty.")

    genes: list[dict[str, str]] = []
    seen: set[str] = set()
    duplicates = 0
    for idx, (lineno, line) in enumerate(rows):
        cells = [c.strip() for c in line.rstrip("\r\n").split("\t")]
        if len(cells) != 2:
            raise TsvFormatError(
                f"Line {lineno}: expected exactly two tab-separated columns "
                f"(gene ID, description) but found {len(cells)}."
            )
        gene_id, desc = cells
        if idx == 0 and _HEADER.match(gene_id):
            continue  # optional header row
        if not _GENE_ID.match(gene_id):
            raise TsvFormatError(
                f"Line {lineno}: the first column must be a gene ID "
                "(1-64 characters, no spaces)."
            )
        if gene_id in seen:
            duplicates += 1
            continue
        seen.add(gene_id)
        genes.append({"id": gene_id, "description": desc})
        if len(genes) > MAX_GENES:
            raise TsvFormatError(f"Too many genes (limit {MAX_GENES}).")

    if not genes:
        raise TsvFormatError("The file does not contain any genes.")
    warnings = []
    if duplicates:
        warnings.append(f"{duplicates} duplicate gene ID(s) were ignored.")
    return ParsedList(genes, warnings)
