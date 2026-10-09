# Gene-list network graph

Selector → network graph feature for the gene-list pages. FastAPI backend (embeddings, edges, lists) +
vanilla-JS/d3 frontend, shipped as one Docker image.

## Run

```bash
# real data: <species>-embeddings.npy / <species>-gene-ids.npy (arabidopsis, pruav, pinsy, picab, potra, betpe)
cp .env.example .env     # then edit EMBEDDINGS_HOST_DIR (absolute path; "~" is not expanded)
docker compose up --build
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
| `experiments.ExperimentSource` | `EXPERIMENT_SOURCE=neo4j`: the heatmap's experiments + expression values (`neo4j_experiments.py`); `mock` (default): `experiment1…5`, pseudo scores | — |
| `embeddings.EmbeddingStore` | `.npy` files, memory-mapped | — |

Endpoints: `GET /api/species|experiments|lists|lists/{id}`, `POST /api/lists/parse-tsv`, `POST /api/lists`, `POST /api/graph`.

## Behaviour notes

* Expression (blue) edges: the experiment list is the heatmap's (`Annotation -[:HAS_EXPERIMENT]-> Experiment`, shown with its species).
  The edge score is the Pearson correlation of two genes' rows in the heatmap matrix, i.e. of the stored `EXPRESSED_IN` values
  across the experiment's samples (`coexpression.py`) - the same source for every experiment. Negative correlations give no edge;
  with several experiments the best score wins. The precomputed `COEXPRESSED_WITH` edges are not used.
* Annotation (black) edges: cosine similarity of embeddings, **different species only**. Expression (blue): **same species only**.
* Every possible edge is returned (all cross-species pairs / all same-species pairs with a score > 0).
  `MAX_EDGES` (default 100000) refuses selections that would produce more, with a clear message.
* Nodes are 25px; edge widths follow the Figma: four classes (0–.25, .25–.5, .5–.75, .75–1) of 0.1 / 0.18 / 0.35 / 0.5px
  (`BINS` in `frontend/src/logic.js`). Strokes scale with zoom. The score filter keeps edges with score **greater than** the value.
* Gene statistics are computed on the edges currently visible (after score filter and hidden lists).
* Shared genes (selected in more than one list): `POST /api/graph/shared-genes` detects them and an information box asks
  how to colour them – colour of the first list, mixed colour of their lists, or custom (one colour for all, or one per gene).
  Lists and shared genes can never use the same colour; those colours are disabled in the customize box.
  A shared gene is hidden only when all its lists are hidden.
* Customize box (`frontend/src/customize.js`): home screen → palette screen (drag boxes onto colours; boxes dropped on each
  other share a colour; drag a name out of a box to separate it) or colour-picker screen (select a name, pick a colour; hex / RGB / HSL,
  opacity, eye-dropper where the browser supports it). Colours may carry opacity (`#rrggbbaa`).
* Performance: edges are painted on a canvas (batched by colour/width), genes are SVG. While you pan/zoom/drag, graphs with more
  than ~15k visible edges draw a sample of them and repaint in full once movement stops. The grouping and layout use each gene's 8
  strongest edges only. Edges are not individually hoverable.
* View: scroll (mouse wheel) or pinch zooms – a wheel notch is one fixed step, a touchpad pinch is proportional; a two-finger swipe on a
  touchpad pans (`gestures.js` tells the two apart from the wheel events). The legend entries "Annotation similarity" / "Expression score"
  hide / show that kind of edge. "Cluster by expression / annotation" re-lays out the genes using only that kind of edge (click again for the
  combined layout). Clicking a gene in the statistics box enlarges it with a yellow glow and nudges its neighbours aside (`focus.js`).
  Clicking a gene selects it (black outline): the genes joined to it by visible edges are pulled around it in rings (strongest edge
  innermost), they and the gene shine, and other genes step aside; click it again or the background to release. Changing the score
  filter, hidden lists or hidden edge types updates the pulled set.
  Delete (or Backspace) removes the selected genes (Ctrl/Cmd+click selects several): a movable window asks first, with a "Do not ask again"
  box (kept in the browser's localStorage, key `ng.skipDeleteConfirm`). The genes leave the graph and the gene selection, so they come back
  unchecked in "Change selection". The pop-ups (selector, shared-genes box, customize box, confirmation) can be moved by dragging them.
  "Change selection" reopens the selector with the previous lists and genes ticked.
* Layout: genes are grouped (Louvain community detection on each gene's 8 strongest edges, `frontend/src/cluster.js`), the groups are
  packed apart from each other and each group is settled by a force simulation that runs once, to rest. Nothing moves afterwards
  except the gene you drag (it stays where dropped). Tune `GROUP_RESOLUTION` in `graph.js` for more / fewer groups.
* Genes cannot be selected; a gene is highlighted only by clicking its ID in the statistics box, and any click outside that box clears it.
* Graph interaction: Ctrl+scroll / pinch zooms, drag pans, dragging a gene moves it.
* Import `.tsv`: exactly two tab-separated columns (gene ID, description); optional header row; duplicates ignored; max 5 MB.
