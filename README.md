# Gene-list network graph

Selector → network graph feature for the gene-list pages. FastAPI backend (embeddings, edges, lists) +
vanilla-JS/d3 frontend, shipped as one Docker image.

## Run

```bash
# real data: <species>-embeddings.npy / <species>-gene-ids.npy (arabidopsis, pruav, pinsy, picab, potra, betpe)
EMBEDDINGS_HOST_DIR=~/Work/plantgenie-api/pg-data/embeddings docker compose up --build
# → http://localhost:8000   (a dev harness list page; open "Network graph")
```

Local development without Docker (synthetic embeddings):

```bash
python scripts/make_fixture_embeddings.py .dev/embeddings
cd backend && pip install -r requirements-dev.txt && pytest
EMBEDDINGS_DIR=../.dev/embeddings DATA_DIR=../.dev/app uvicorn app.main:create_app --factory --reload   # :8000
cd frontend && npm ci && npm run dev    # :5173, proxies /api to :8000;  npm test for the logic tests
```

## Integrating into the mother API

Frontend: `openNetworkGraph({ host, apiBase, listId, selectedGeneIds, onClose })` (`frontend/src/feature.js`).
`listId` is the list page the user is on; `selectedGeneIds` are the genes ticked there (→ "Selected genes").
The graph page takes over the viewport (`.ng-root.has-graph`); restyle that class to embed it elsewhere.

Backend seams (replace the stand-ins, keep the HTTP contract):

| Seam | Today | Replace with |
|---|---|---|
| `lists.ListsProvider` (`list_lists`, `get_list`, `save_list`) | JSON file in `DATA_DIR`, optional demo lists | the mother API's list store |
| `experiments.ExperimentSource` | mock: `experiment1…5`, deterministic pseudo scores | Neo4j reader (`EXPERIMENT_SOURCE=neo4j`) |
| `embeddings.EmbeddingStore` | `.npy` files, memory-mapped | — |

Endpoints: `GET /api/species|experiments|lists|lists/{id}`, `POST /api/lists/parse-tsv`, `POST /api/lists`, `POST /api/graph`.

## Behaviour notes

* Annotation (black) edges: cosine similarity of embeddings, **different species only**. Expression (blue): **same species only**.
* To keep edges proportional to nodes, each gene keeps its top `EDGES_PER_NODE` (default 3) partners per edge type.
  Line thickness has four classes (0–.25, .25–.5, .5–.75, .75–1). The score filter keeps edges with score **greater than** the value.
* Gene statistics are computed on the edges currently visible (after score filter and hidden lists).
* A gene present in several lists takes the colour of the first one and is hidden only when all its lists are hidden.
* Graph interaction: Ctrl+scroll / pinch zooms, drag pans, dragging a gene pins it, double-click unpins.
* Import `.tsv`: exactly two tab-separated columns (gene ID, description); optional header row; duplicates ignored; max 5 MB.
