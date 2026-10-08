import { h, clear } from './dom.js';
import { geneStats, rank } from './logic.js';

const ROW_H = 18;

/** "Gene statistics" box: most connected genes / genes with the highest summed score. */
export function createStats({ onSelect }) {
  const st = { expanded: { degree: false, sum: false }, edges: [], selected: null, fit: 3 };
  const root = h('div', { class: 'stats' });

  const column = (title, key, fmt, tip) => {
    const stats = geneStats(st.edges);
    const all = rank(stats, key, { expanded: true, fit: 0 });          // top 10 (+ ties)
    const shown = rank(stats, key, { expanded: st.expanded[key], fit: st.fit });
    const canExpand = all.length > shown.length || st.expanded[key];
    return h('div', { class: 'stats-col' },
      h('div', { class: 'stats-col-title', title: tip }, title),
      h('div', { class: 'stats-rows' + (st.expanded[key] ? ' scroll' : '') },
        shown.length ? shown.map((g) => h('button', {
          class: 'stat-row' + (g.id === st.selected ? ' selected' : ''), title: `${g.id} — click to locate it in the graph`,
          onclick: () => { st.selected = st.selected === g.id ? null : g.id; render(); onSelect(st.selected); },
        }, h('span', { class: 'stat-id' }, g.id), h('span', { class: 'stat-val' }, fmt(g))))
          : h('div', { class: 'muted tiny' }, 'No connected genes')),
      canExpand && h('button', { class: 'link tiny', title: st.expanded[key] ? 'Show fewer genes' : 'Show the top 10 genes',
        onclick: () => { st.expanded[key] = !st.expanded[key]; render(); } },
      st.expanded[key] ? 'Show less' : 'Show more'));
  };

  function render() {
    clear(root);
    root.append(
      h('div', { class: 'stats-title' }, 'Gene statistics'),
      h('div', { class: 'stats-cols' },
        column('Most connected genes', 'degree', (g) => `${g.degree} edge${g.degree === 1 ? '' : 's'}`,
          'Genes with the most edges connected to them'),
        column('Top significant genes', 'sum', (g) => g.sum.toFixed(2),
          'Genes with the highest sum of the scores of their edges')));
  }

  // number of rows that fit in the box without making it taller than the graph frame
  const ro = new ResizeObserver(() => {
    const avail = root.clientHeight - 74;
    const fit = Math.max(1, Math.floor(avail / ROW_H));
    if (fit !== st.fit) { st.fit = fit; render(); }
  });
  ro.observe(root);
  render();

  return {
    el: root,
    update(edges) { st.edges = edges; render(); },
    setSelected(id) { st.selected = id; render(); },
    destroy() { ro.disconnect(); },
  };
}
