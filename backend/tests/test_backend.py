from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.tsv import TsvFormatError, parse_tsv

import importlib.util
spec = importlib.util.spec_from_file_location(
    "fixtures", Path(__file__).parents[2] / "scripts" / "make_fixture_embeddings.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("d")
    fixtures.main(root / "emb", n=120)
    s = Settings(embeddings_dir=root / "emb", data_dir=root / "app", frontend_dist=root / "none")
    app = create_app(s)
    return TestClient(app)


# ---- TSV ----
def test_tsv_ok_with_header_and_duplicates():
    p = parse_tsv("gene_id\tdescription\nA1\tfoo\nA2\t\nA1\tdup\n")
    assert [g["id"] for g in p.genes] == ["A1", "A2"]
    assert p.warnings and "1 duplicate" in p.warnings[0]


@pytest.mark.parametrize("text", [
    "", "\n\n", "A1 foo\nA2 bar", "A1\tfoo\tbar", "A1\nA2", "\tdesc", "A 1\tfoo", "A1\x00\tx",
])
def test_tsv_rejects(text):
    with pytest.raises(TsvFormatError):
        parse_tsv(text)


def test_parse_endpoint_rejects_wrong_extension(client):
    r = client.post("/api/lists/parse-tsv", json={"filename": "x.pdf", "text": "A\tb"})
    assert r.status_code == 422


# ---- lists & graph ----
def test_demo_lists_seeded(client):
    lists = client.get("/api/lists").json()
    assert [l["species"] for l in lists] == ["pinsy", "pinsy", "potra"]


def test_graph_edge_rules(client):
    sel = [{"id": "demo1"}, {"id": "demo3"}]
    g = client.post("/api/graph", json={"lists": sel, "experiment_ids": ["experiment1"]}).json()
    sp = {n["id"]: n["species"] for n in g["nodes"]}
    kinds = {e["type"] for e in g["edges"]}
    assert kinds == {"annotation", "expression"}
    for e in g["edges"]:
        assert 0 < e["score"] <= 1
        same = sp[e["source"]] == sp[e["target"]]
        assert same == (e["type"] == "expression")  # black cross-species, blue same-species


def test_graph_gene_subset_and_no_experiment(client):
    lst = client.get("/api/lists/demo1").json()
    ids = [g["id"] for g in lst["genes"][:5]]
    g = client.post("/api/graph", json={"lists": [{"id": "demo1", "gene_ids": ids}]}).json()
    assert sorted(n["id"] for n in g["nodes"]) == sorted(ids)
    assert g["edges"] == []  # one species, no experiment -> nothing to connect


def test_missing_embeddings_reported(client):
    saved = client.post("/api/lists", json={"name": "x", "species": "arath", "genes": [
        {"id": "NOT_A_GENE", "description": "?"}]})
    assert saved.status_code == 201
    g = client.post("/api/graph", json={"lists": [{"id": saved.json()["id"]}]}).json()
    assert g["missing"] == [{"gene_id": "NOT_A_GENE", "species": "arath"}]


def test_validation_errors(client):
    assert client.post("/api/graph", json={"lists": [{"id": "nope"}]}).status_code == 404
    assert client.post("/api/graph", json={"lists": [{"id": "demo1"}],
                                           "experiment_ids": ["bogus"]}).status_code == 422
    assert client.post("/api/lists", json={"name": "x", "species": "zzzzz",
                                           "genes": [{"id": "a"}]}).status_code == 422
    assert client.post("/api/graph", json={"lists": [{"id": "demo1", "gene_ids": []}]}).status_code == 422


def test_all_possible_edges_are_returned(client):
    sel = [{"id": "demo1"}, {"id": "demo3"}]          # 40 pinsy + 40 potra genes
    g = client.post("/api/graph", json={"lists": sel}).json()
    ann = [e for e in g["edges"] if e["type"] == "annotation"]
    emb = client.app.state.store
    _, a = emb.get("pinsy", [x["id"] for x in client.get("/api/lists/demo1").json()["genes"]])
    _, b = emb.get("potra", [x["id"] for x in client.get("/api/lists/demo3").json()["genes"]])
    assert len(ann) == int(((a @ b.T) > 0).sum())      # every cross-species pair with a positive score
    assert len(ann) > 3 * len(g["nodes"])              # i.e. no longer capped per gene


def test_expression_edges_cover_all_same_species_pairs(client):
    g = client.post("/api/graph", json={"lists": [{"id": "demo1"}], "experiment_ids": ["experiment1"]}).json()
    n = len(g["nodes"])
    assert 0 < len(g["edges"]) <= n * (n - 1) // 2
    assert len(g["edges"]) > 3 * n


def test_too_many_edges_is_a_clear_error(tmp_path):
    fixtures.main(tmp_path / "emb", n=60)
    s = Settings(embeddings_dir=tmp_path / "emb", data_dir=tmp_path / "app", frontend_dist=tmp_path / "x", max_edges=50)
    c = TestClient(create_app(s))
    r = c.post("/api/graph", json={"lists": [{"id": "demo1"}, {"id": "demo3"}]})
    assert r.status_code == 422 and "edges" in r.json()["detail"]


def test_shared_genes(client):
    lst = client.get("/api/lists/demo1").json()["genes"]
    a = client.post("/api/lists", json={"name": "A", "species": "pinsy", "genes": lst[:6]}).json()["id"]
    b = client.post("/api/lists", json={"name": "B", "species": "pinsy", "genes": lst[3:9]}).json()["id"]
    c = client.post("/api/lists", json={"name": "C", "species": "pinsy", "genes": lst[4:5]}).json()["id"]
    r = client.post("/api/graph/shared-genes", json={"lists": [{"id": a}, {"id": b}, {"id": c}]}).json()["genes"]
    by = {g["id"]: [l["name"] for l in g["lists"]] for g in r}
    assert by == {lst[3]["id"]: ["A", "B"], lst[4]["id"]: ["A", "B", "C"], lst[5]["id"]: ["A", "B"]}
    # only the *selected* genes count
    r2 = client.post("/api/graph/shared-genes", json={"lists": [
        {"id": a, "gene_ids": [lst[0]["id"]]}, {"id": b}]}).json()["genes"]
    assert r2 == []
    # graph nodes carry all their lists
    g = client.post("/api/graph", json={"lists": [{"id": a}, {"id": b}]}).json()
    assert len(g["nodes"]) == 9 and sum(len(n["lists"]) > 1 for n in g["nodes"]) == 3
