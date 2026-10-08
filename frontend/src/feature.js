import { createApi } from './api.js';
import { createSelector } from './selector.js';
import { createGraphView } from './view.js';
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
  let selector = null, view = null;
  const scope = document.createElement('div');
  scope.className = 'ng-root';
  host.append(scope);

  async function showSelector() {
    view?.destroy(); view = null;
    scope.classList.remove('has-graph');
    selector?.destroy();
    selector = createSelector({ api, listId, selectedGeneIds,
      onClose: () => { selector.destroy(); selector = null; onClose(); },
      onProceed: (selection) => showGraph(selection) });
    scope.append(selector.el);
  }

  async function showGraph(selection) {
    selector?.destroy(); selector = null;
    let lists = [], species = [];
    try { [lists, species] = await Promise.all([api.lists(), api.species()]); } catch { /* names are cosmetic */ }
    const byId = new Map(lists.map((l) => [l.id, l]));
    const picked = selection.map((s) => byId.get(s.id)).filter(Boolean);
    const speciesName = new Map(species.map((s) => [s.code, s.name]));
    view = createGraphView({
      api, selection,
      sourceName: byId.get(listId)?.name ?? picked[0]?.name ?? 'Network graph',
      speciesNames: [...new Set(picked.map((l) => speciesName.get(l.species) ?? l.species))],
      onChangeSelection: showSelector,
      onBack: () => { destroy(); onClose(); },
    });
    scope.classList.add('has-graph');
    scope.append(view.el);
  }

  function destroy() { selector?.destroy(); view?.destroy(); scope.remove(); }
  showSelector();
  return { destroy };
}
