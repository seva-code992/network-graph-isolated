import { h, clear, onOutsideClick, lineSample, makeDraggable } from './dom.js';
import { confirmDeleteGenes, deleteConfirmSkipped } from './confirm.js';
import { createGraph, ZOOM_RANGE } from './graph.js';
import { createStats } from './stats.js';
import { createCustomize } from './customize.js';
import { BINS, idOf, nodeVisible, visibleEdges } from './logic.js';
import { buildColorModes } from './colorModes.js';
import { exportPng, exportSvg, exportTsv } from './export.js';

const fmt = (x) => x.toFixed(2);

/** The network-graph page. selection = [{id, gene_ids?}] coming from the selector. */
export function createGraphView({ api, selection, colors, sourceName, speciesNames, onChangeSelection, onBack }) {
  const st = {
    data: null, loading: true, error: '', experiments: [], expIds: [], threshold: 0,
    hidden: new Set(), hiddenTypes: new Set(), cluster: null, colors, seq: 0, showMissing: false, expOpen: false, exportOpen: false,
  };
  const disposers = [];
  let current = selection.map((s) => ({ ...s }));   // the genes in the graph: shrinks when genes are deleted
  const listName = (id) => st.data?.lists.find((l) => l.id === id)?.name ?? id;

  // ---------- skeleton ----------
  const tooltip = h('div', { class: 'tooltip', hidden: true });
  const host = h('div', { class: 'graph-host' });
  const loadingEl = h('div', { class: 'graph-overlay' });
  const emptyEl = h('div', { class: 'graph-empty', hidden: true });
  const filterVal = h('span', { class: 'filter-val' }, '0.00');
  const filter = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', class: 'filter-range',
    'aria-label': 'Minimum edge score', oninput: (e) => { st.threshold = +e.target.value; filterVal.textContent = fmt(st.threshold); scheduleRefresh(); } });
  const zoomPct = h('span', { class: 'zoom-pct' }, '100%');
  const zoomRange = h('input', { type: 'range', class: 'zoom-range', min: '-300', max: '300', step: '1', value: '0',
    title: 'Zoom (scroll or pinch also works)', 'aria-label': 'Zoom',
    oninput: (e) => graph.zoomTo(2 ** (+e.target.value / 100)) });
  const clusterBtns = {
    expression: h('button', { class: 'cluster-btn', onclick: () => setCluster('expression') }, 'Cluster by expression'),
    annotation: h('button', { class: 'cluster-btn', onclick: () => setCluster('annotation') }, 'Cluster by annotation'),
  };
  const customizeBtn = h('button', { class: 'customize-btn', title: 'Customize the colours of nodes and edges',
    onclick: () => customize.toggle() }, 'Customize');

  const graph = createGraph(host, {
    tooltip, listName,
    onSelect(ids) { if (ids.length) stats.setSelected(null); },   // a clicked gene replaces the one located via the statistics box
    onZoom(k) { zoomPct.textContent = `${Math.round(k * 100)}%`; zoomRange.value = String(Math.round(Math.log2(k) * 100)); },
  });
  const stats = createStats({ onSelect: (id) => (id ? graph.highlight(id) : graph.clearHighlight()) });
  const legendEl = h('div', { class: 'legend' });
  // lists, shared genes and edges are all customised here; modes are rebuilt from the loaded data
  const modes = () => buildColorModes({ colors: st.colors, lists: st.data?.lists ?? [],
    sharedGenes: (st.data?.nodes ?? []).filter((n) => n.lists.length > 1) });
  const customize = createCustomize({
    getModes: () => modes().getModes(), getItems: (m) => modes().getItems(m), isBlocked: (m, c) => modes().isBlocked(m, c),
    onChange: () => { graph.setColors(st.colors); renderLegend(); }, ignoreOutside: [customizeBtn] });

  const tagsEl = h('div', { class: 'tags' });
  const expBtn = h('button', { class: 'select-btn', 'aria-haspopup': 'listbox', title: 'Choose one or more expression experiments',
    onclick: () => { st.expOpen = !st.expOpen; renderExp(); } });
  const expList = h('div', { class: 'popover exp-list', role: 'listbox', 'aria-multiselectable': 'true', hidden: true });
  const expDesc = h('div', { class: 'exp-desc' });
  const exportBtn = h('button', { class: 'export-btn', title: 'Export the graph', onclick: () => { st.exportOpen = !st.exportOpen; renderExport(); } }, 'Export ▾');
  const exportMenu = h('div', { class: 'popover export-menu', hidden: true });
  const missingEl = h('div', { class: 'note', hidden: true });
  const toastEl = h('div', { class: 'graph-toast', hidden: true, role: 'status' });

  const el = h('div', { class: 'graph-page' },
    h('nav', { class: 'breadcrumb' }, 'Lists › ',
      h('button', { class: 'link', onclick: onBack, title: 'Back to the list page' }, sourceName), ' › Network graph', ' ',
      h('button', { class: 'link', onclick: () => onChangeSelection(current), title: 'Go back to the gene selector' }, '· Change selection')),
    h('section', { class: 'card header-card' },
      h('div', { class: 'header-left' }, h('h1', {}, sourceName), h('div', { class: 'subtitle' }, 'Network graph'), tagsEl),
      h('div', { class: 'header-mid' }, h('div', { class: 'field-label' }, 'Expression experiment'),
        h('div', { class: 'select-wrap' }, expBtn, expList), expDesc),
      h('div', { class: 'header-right' }, h('div', { class: 'select-wrap' }, exportBtn, exportMenu))),
    h('section', { class: 'card graph-card' },
      h('div', { class: 'graph-area' }, host, tooltip,
        h('div', { class: 'score-filter', title: 'Only edges with a score greater than this value are shown' },
          h('div', { class: 'filter-title' }, 'Score filter ', filterVal),
          h('div', { class: 'filter-box' }, h('span', {}, '0'), filter, h('span', {}, '1'))),
        emptyEl, loadingEl, toastEl,
        h('div', { class: 'graph-tools' },
          h('div', { class: 'cluster-box', role: 'group', 'aria-label': 'Layout' }, clusterBtns.expression, clusterBtns.annotation), customizeBtn,
          h('div', { class: 'zoom-box' },
            h('button', { class: 'reset-btn', title: 'Reset the view to fit the whole graph', onclick: () => graph.reset() }, 'Reset'),
            h('div', { class: 'zoom-row' },
              h('button', { class: 'zbtn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => graph.zoomBy(1 / 1.4) }, '−'),
              zoomRange,
              h('button', { class: 'zbtn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => graph.zoomBy(1.4) }, '+')),
            zoomPct)),
        h('div', { class: 'graph-hint' }, 'Scroll or pinch to zoom · drag or swipe to pan · click a gene to select it (Ctrl+click: several, Delete: remove) · drag a gene to move it')),
      h('aside', { class: 'graph-side' }, legendEl, stats.el)),
    customize.el, missingEl);

  // ---------- rendering ----------
  function renderTags() {
    clear(tagsEl);
    const nGenes = st.data?.nodes.length;
    tagsEl.append(...speciesNames.map((s) => h('span', { class: 'tag' }, s)),
      nGenes != null && h('span', { class: 'tag' }, `${nGenes} genes`));
  }

  function renderLegend() {
    clear(legendEl);
    if (!st.data) return;
    const c = st.colors;
    legendEl.append(
      h('div', { class: 'legend-lists' }, st.data.lists.map((l) => h('button', {
        class: 'legend-item' + (st.hidden.has(l.id) ? ' off' : ''), 'aria-pressed': String(!st.hidden.has(l.id)),
        title: st.hidden.has(l.id) ? 'Click to show the nodes and edges of this list' : 'Click to hide the nodes and edges of this list',
        onclick: () => { st.hidden.has(l.id) ? st.hidden.delete(l.id) : st.hidden.add(l.id); renderLegend(); refresh(); },
      }, h('span', { class: 'dot', style: { background: c.nodes[l.id] } }), h('span', { class: 'legend-name' }, l.name)))),
      edgeLegend('annotation', 'Annotation similarity', c.edges.annotation, 'Black lines connect genes of different species, by similarity of their annotation embeddings'),
      edgeLegend('expression', 'Expression score', c.edges.expression, 'Blue lines connect genes of the same species, by expression score in the selected experiments'));
  }
  const edgeLegend = (type, title, color, tip) => h('button', {
    class: 'edge-legend' + (st.hiddenTypes.has(type) ? ' off' : ''), 'aria-pressed': String(!st.hiddenTypes.has(type)),
    title: `${tip}. Click to ${st.hiddenTypes.has(type) ? 'show' : 'hide'} these edges`,
    onclick: () => { st.hiddenTypes.has(type) ? st.hiddenTypes.delete(type) : st.hiddenTypes.add(type); renderLegend(); refresh(); } },
    h('div', { class: 'edge-legend-title' }, title),
    BINS.map((b) => h('div', { class: 'edge-legend-row' },
      lineSample(color, b.width),
      h('span', {}, `${fmt(b.min)}–${fmt(b.max)}`))));

  function renderExp() {
    expBtn.textContent = '';
    expBtn.append(h('span', { class: 'select-text' }, st.expIds.length === 0 ? 'Choose an expression experiment'
      : st.expIds.length === 1 ? st.expIds[0] : `${st.expIds.length} experiments selected`), h('span', { class: 'caret' }, '▾'));
    expBtn.setAttribute('aria-expanded', String(st.expOpen));
    expList.hidden = !st.expOpen;
    clear(expList);
    expList.append(...st.experiments.map((x) => h('label', { class: 'exp-item', title: x.description || x.name, role: 'option',
      'aria-selected': String(st.expIds.includes(x.id)) },
      h('input', { type: 'checkbox', checked: st.expIds.includes(x.id), onchange: () => toggleExperiment(x.id) }), x.name,
      x.species ? h('span', { class: 'exp-species' }, ` (${x.species})`) : null)));
    expDesc.textContent = st.expIds.length ? `Blue edges: expression in ${st.expIds.join(', ')}`
      : 'Select one or more experiments to add expression (blue) edges';
  }
  function renderExport() {
    exportMenu.hidden = !st.exportOpen;
    clear(exportMenu);
    const item = (label, fn, tip) => h('button', { class: 'menu-item', title: tip,
      onclick: () => { st.exportOpen = false; renderExport(); fn(); } }, label);
    const vis = () => { const v = st.data.nodes.filter((n) => nodeVisible(n, st.hidden)); return [v, shownEdges()]; };
    exportMenu.append(
      item('PNG image', () => exportPng(graph.toSvgString(), graph.size(), 'network-graph'), 'Download the current view as a PNG image'),
      item('SVG image', () => exportSvg(graph.toSvgString(), 'network-graph'), 'Download the current view as a vector SVG'),
      item('TSV matrix', () => exportTsv(...vis(), 'network-graph'), 'Download the visible genes and their edge scores as a matrix'));
    exportBtn.disabled = !st.data;
  }

  function renderMissing() {
    const miss = st.data?.missing ?? [];
    missingEl.hidden = miss.length === 0;
    if (!miss.length) return;
    clear(missingEl);
    missingEl.append(
      h('div', { class: 'note-title' }, `${miss.length} gene${miss.length === 1 ? '' : 's'} could not be found in the annotation embeddings`),
      h('div', { class: 'note-sub' }, 'They are shown in the graph but have no annotation (black) edges. ',
        h('button', { class: 'link', onclick: () => { st.showMissing = !st.showMissing; renderMissing(); } },
          st.showMissing ? 'Hide genes' : 'Show genes')),
      st.showMissing && h('div', { class: 'missing-list' }, miss.map((m) => h('span', { class: 'missing-id' }, m.gene_id))));
  }

  function renderStatus() {
    loadingEl.hidden = !(st.loading || st.error);
    clear(loadingEl);
    loadingEl.append(st.error ? h('div', { class: 'error' }, st.error, ' ', h('button', { class: 'link', onclick: () => load() }, 'Retry'))
      : h('div', { class: 'spinner-text' }, 'Building graph…'));
  }

  const shownEdges = () => (st.data ? visibleEdges(st.data.nodes, st.data.edges, st.threshold, st.hidden, st.hiddenTypes) : []);

  let refreshQueued = false;
  const scheduleRefresh = () => { if (!refreshQueued) { refreshQueued = true; requestAnimationFrame(() => { refreshQueued = false; refresh(); }); } };

  /** threshold / hidden-list changes: update the graph, the stats box and the hints. */
  function refresh() {
    if (!st.data) return;
    graph.setThreshold(st.threshold);
    graph.setHidden(st.hidden);
    graph.setHiddenTypes(st.hiddenTypes);
    const edges = shownEdges();
    stats.update(edges);
    emptyEl.hidden = st.loading || edges.length > 0;
    emptyEl.textContent = st.data.edges.length === 0
      ? 'No edges to show. Annotation edges need genes from at least two species; choose an expression experiment for same-species edges.'
      : 'No edges above the current score filter.';
  }

  // ---------- deleting genes ----------
  let toastTimer;
  const toast = (text) => {
    toastEl.textContent = text; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
  };
  let asking = false;

  /** Delete the selected genes (Delete key): out of the graph, and out of the gene selection. */
  async function deleteSelected() {
    const ids = graph.selectedIds();
    if (!ids.length || !st.data || st.loading || asking) return;
    if (ids.length >= st.data.nodes.length) return toast('A graph needs at least one gene – select fewer genes to delete.');
    if (!deleteConfirmSkipped()) {
      asking = true;
      const ok = await confirmDeleteGenes(ids, el.closest('.ng-root') ?? document.body);
      asking = false;
      if (!ok || !st.data) return;
    }
    const gone = new Set(ids);
    const touched = new Set(st.data.nodes.filter((n) => gone.has(n.id)).flatMap((n) => n.lists));
    st.data = { ...st.data, nodes: st.data.nodes.filter((n) => !gone.has(n.id)),
      edges: st.data.edges.filter((e) => !gone.has(idOf(e.source)) && !gone.has(idOf(e.target))),
      missing: st.data.missing.filter((m) => !gone.has(m.gene_id)) };
    // every affected list now names its remaining genes explicitly (a list left empty drops out)
    current = current.flatMap((s) => {
      if (!touched.has(s.id)) return [s];
      const rest = st.data.nodes.filter((n) => n.lists.includes(s.id)).map((n) => n.id);
      return rest.length ? [{ id: s.id, gene_ids: rest }] : [];
    });
    graph.removeNodes(ids);
    stats.setSelected(null);
    renderTags(); renderMissing(); renderCluster();
    refresh();
  }

  // ---------- clustering ----------
  /** Lay the genes out by one kind of edge only; clicking the active button goes back to the combined layout. */
  function setCluster(type) {
    st.cluster = st.cluster === type ? null : type;
    stats.setSelected(null);
    graph.recluster(st.cluster);
    renderCluster();
  }
  function renderCluster() {
    for (const [type, btn] of Object.entries(clusterBtns)) {
      const has = !!st.data?.edges.some((e) => e.type === type);
      btn.disabled = !has;
      btn.classList.toggle('active', st.cluster === type);
      btn.setAttribute('aria-pressed', String(st.cluster === type));
      btn.title = !has ? (type === 'expression' ? 'Choose an expression experiment first' : 'Annotation edges need genes from at least two species')
        : st.cluster === type ? 'Click to go back to the combined layout'
        : `Group the genes by their ${type} edges only`;
    }
  }

  // ---------- data ----------
  let debounce;
  function toggleExperiment(id) {
    st.expIds = st.expIds.includes(id) ? st.expIds.filter((x) => x !== id) : [...st.expIds, id];
    renderExp(); // the list stays open so several experiments can be picked
    clearTimeout(debounce);
    debounce = setTimeout(() => load(), 250);
  }

  async function load() {
    const seq = ++st.seq;
    st.loading = true; st.error = '';
    renderStatus();
    try {
      const data = await api.graph({ lists: current, experiment_ids: st.expIds });
      if (seq !== st.seq) return; // a newer request superseded this one
      st.data = data;
      if (st.cluster && !data.edges.some((e) => e.type === st.cluster)) st.cluster = null;   // e.g. the experiment was removed
      graph.setColors(st.colors);
      graph.setData(data.nodes, data.edges, st.cluster);   // resets the layout, pins and view
      graph.setThreshold(st.threshold);
      graph.setHidden(st.hidden);
      stats.setSelected(null);
      renderTags(); renderLegend(); renderMissing(); renderExport(); renderCluster();
    } catch (e) {
      if (seq !== st.seq) return;
      st.error = e.message;
    }
    st.loading = false;
    renderStatus();
    refresh();
  }

  // ---------- init ----------
  // a gene is highlighted only through the statistics box; any click elsewhere makes it neutral again
  disposers.push(onOutsideClick([stats.el], () => { stats.setSelected(null); graph.clearHighlight(); }));
  disposers.push(onOutsideClick([expBtn, expList], () => { if (st.expOpen) { st.expOpen = false; renderExp(); } }));
  disposers.push(onOutsideClick([exportBtn, exportMenu], () => { if (st.exportOpen) { st.exportOpen = false; renderExport(); } }));
  const onDelete = (e) => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    if (!graph.selectedIds().length) return;
    e.preventDefault();
    deleteSelected();
  };
  document.addEventListener('keydown', onDelete);
  disposers.push(() => document.removeEventListener('keydown', onDelete));
  const onKey = (e) => { if (e.key === 'Escape') { st.expOpen = st.exportOpen = false; renderExp(); renderExport(); customize.close(); } };
  document.addEventListener('keydown', onKey);
  renderTags(); renderExp(); renderExport(); renderStatus(); renderCluster();
  api.experiments().then((x) => { st.experiments = x; renderExp(); }).catch((e) => { st.error = e.message; renderStatus(); });
  load();

  return {
    el,
    destroy() {
      clearTimeout(debounce); clearTimeout(toastTimer); st.seq++;
      disposers.forEach((d) => d());
      document.removeEventListener('keydown', onKey);
      stats.destroy(); graph.destroy(); el.remove();
    },
  };
}
export { ZOOM_RANGE };
