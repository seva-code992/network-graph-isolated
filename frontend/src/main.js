// Development harness: a stand-in for the mother API's gene-list page.
// ?list=<id> picks the list shown; tick genes before pressing "Network graph" to test "Selected genes".
import { createApi } from './api.js';
import { h } from './dom.js';
import { openNetworkGraph } from './feature.js';

const app = document.getElementById('app');
const api = createApi('');
const params = new URLSearchParams(location.search);

async function main() {
  const lists = await api.lists();
  const listId = params.get('list') || lists[0]?.id;
  const list = listId ? await api.list(listId) : null;
  const ticked = new Set();
  let feature = null;
  const stage = h('div', { class: 'ng-stage' });

  const btn = h('button', { class: 'ng-open', onclick: () => {
    feature?.destroy();
    feature = openNetworkGraph({ host: stage, listId, selectedGeneIds: [...ticked], onClose: () => { feature = null; } });
  } }, 'Network graph');

  app.append(
    h('header', { class: 'ng-nav' }, h('span', { class: 'ng-logo' }, '🌿 GeneList'), h('span', { class: 'ng-dev' }, 'dev harness — replaced by the host list page')),
    h('main', { class: 'ng-page' },
      list ? h('div', { class: 'card ng-list' },
        h('div', { class: 'ng-list-head' }, h('div', {}, h('h1', {}, list.name), h('div', { class: 'subtitle' }, `${list.species} · ${list.genes.length} genes`)), btn),
        h('div', { class: 'ng-table' }, list.genes.map((g) => h('label', { class: 'ng-gene' },
          h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? ticked.add(g.id) : ticked.delete(g.id)) }),
          h('b', {}, g.id), h('span', {}, g.description)))))
        : h('div', { class: 'card' }, 'No lists available yet.', btn),
      stage));
}
main().catch((e) => { app.textContent = `Failed to load: ${e.message}`; });
