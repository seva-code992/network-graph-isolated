import { createApi } from './api.js';
import { createSelector } from './selector.js';
import { createGraphView } from './view.js';
import { createSharedDialog } from './shared.js';
import { defaultShared } from './colorModes.js';
import { DEFAULT_EDGE_COLORS, randomNodeColors } from './palettes.js';
import './styles.css';

/**
 * Entry point for the host application ("mother API" list page).
 *
 *   const nb = openNetworkGraph({ host, apiBase, listId, selectedGeneIds });
 *   nb.destroy();
 *
 * host            element the feature renders into (the graph page replaces its content)
 * listId          list the user is currently looking at (pre-selected in the selector)
 * selectedGeneIds genes ticked on that list page, if any ("Selected genes" in the selector)
 */
export function openNetworkGraph({ host, apiBase = '', listId, selectedGeneIds = [], onClose = () => {} }) {
  const api = createApi(apiBase);
  let selector = null, view = null, dialog = null;
  const scope = document.createElement('div');
  scope.className = 'ng-root';
  host.append(scope);

  async function showSelector() {
    view?.destroy(); view = null;
    dialog?.destroy(); dialog = null;
    scope.classList.remove('has-graph');
    selector?.destroy();
    selector = createSelector({ api, listId, selectedGeneIds,
      onClose: () => { selector.destroy(); selector = null; onClose(); },
      onProceed: (selection) => proceed(selection) });
    scope.append(selector.el);
  }

  /** Selector done: ask how to colour genes shared between lists (if any), then build the graph. */
  async function proceed(selection) {
    selector?.destroy(); selector = null;
    let lists = [], species = [], shared = [];
    try { [lists, species] = await Promise.all([api.lists(), api.species()]); } catch { /* names are cosmetic */ }
    try { shared = (await api.sharedGenes(selection)).genes; } catch { /* the graph request will report real errors */ }
    const byId = new Map(lists.map((l) => [l.id, l]));
    // one random colour per list from the default palette, decided up front so the shared-gene choices can avoid them
    const colors = { nodes: randomNodeColors(selection.map((s) => s.id)), edges: { ...DEFAULT_EDGE_COLORS }, shared: defaultShared() };
    if (!shared.length) return showGraph(selection, colors, byId, species);
    dialog = createSharedDialog({
      colors, lists: selection.map((s) => byId.get(s.id)).filter(Boolean),
      sharedGenes: shared.map((g) => ({ id: g.id, lists: g.lists.map((l) => l.id) })),
      onBack: () => { dialog.destroy(); dialog = null; showSelector(); },
      onContinue: () => { dialog.destroy(); dialog = null; showGraph(selection, colors, byId, species); },
    });
    scope.append(dialog.el);
  }

  function showGraph(selection, colors, byId, species) {
    const picked = selection.map((s) => byId.get(s.id)).filter(Boolean);
    const speciesName = new Map(species.map((s) => [s.code, s.name]));
    view = createGraphView({
      api, selection, colors,
      sourceName: byId.get(listId)?.name ?? picked[0]?.name ?? 'Network graph',
      speciesNames: [...new Set(picked.map((l) => speciesName.get(l.species) ?? l.species))],
      onChangeSelection: showSelector,
      onBack: () => { destroy(); onClose(); },
    });
    scope.classList.add('has-graph');
    scope.append(view.el);
  }

  function destroy() { selector?.destroy(); view?.destroy(); dialog?.destroy(); scope.remove(); }
  showSelector();
  return { destroy };
}
