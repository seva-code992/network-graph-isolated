// Pure graph logic (no DOM) – unit tested in test/logic.test.js.

// Four line-thickness classes shown in the legend; width in px (the Figma values:
// 0.5px = similarity 1, 0.1px = the thinnest line).
export const BINS = [
  { min: 0, max: 0.25, width: 0.1 },
  { min: 0.25, max: 0.5, width: 0.18 },
  { min: 0.5, max: 0.75, width: 0.35 },
  { min: 0.75, max: 1, width: 0.5 },
];

export function binOf(score) {
  const i = BINS.findIndex((b) => score < b.max);
  return i === -1 ? BINS.length - 1 : i;
}
export const edgeWidth = (score) => BINS[binOf(score)].width;

/** A gene is hidden only when every list it belongs to is hidden. */
export const nodeVisible = (node, hiddenLists) => node.lists.some((l) => !hiddenLists.has(l));

/** Edges whose score is greater than `threshold` and whose two genes are visible. */
export function visibleEdges(nodes, edges, threshold, hiddenLists) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.filter((e) => {
    const s = byId.get(idOf(e.source)), t = byId.get(idOf(e.target));
    return e.score > threshold && s && t && nodeVisible(s, hiddenLists) && nodeVisible(t, hiddenLists);
  });
}
// d3.forceLink replaces ids by node objects
export const idOf = (x) => (typeof x === 'object' ? x.id : x);

const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** Per gene: number of connected edges and the sum of their scores. */
export function geneStats(edges) {
  const m = new Map();
  const bump = (id, score) => {
    const s = m.get(id) || { id, degree: 0, sum: 0 };
    s.degree += 1;
    s.sum += score;
    m.set(id, s);
  };
  for (const e of edges) {
    bump(idOf(e.source), e.score);
    bump(idOf(e.target), e.score);
  }
  for (const s of m.values()) s.sum = round4(s.sum);
  return [...m.values()];
}

/**
 * Rank genes by `key`, dropping zero scores.
 * collapsed: the first `fit` genes. expanded: the top 10 plus every gene tied with the 10th.
 */
export function rank(stats, key, { expanded, fit }) {
  const sorted = stats.filter((s) => s[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.id.localeCompare(b.id));
  if (!expanded) return sorted.slice(0, Math.max(1, fit));
  if (sorted.length <= 10) return sorted;
  const cut = sorted[9][key];
  return sorted.filter((s, i) => i < 10 || s[key] === cut);
}

/** Adjacency matrix (TSV text) of the given nodes/edges; cell = edge score or 0. */
export function matrixTsv(nodes, edges) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const m = nodes.map(() => new Array(nodes.length).fill(0));
  for (const e of edges) {
    const a = idx.get(idOf(e.source)), b = idx.get(idOf(e.target));
    if (a !== undefined && b !== undefined) m[a][b] = m[b][a] = e.score;
  }
  return [['gene', ...nodes.map((n) => n.id)].join('\t'),
    ...nodes.map((n, i) => [n.id, ...m[i]].join('\t'))].join('\n') + '\n';
}

/** Colour at position t (0..1) of a multi-stop gradient. */
export function gradientColor(stops, t) {
  t = Math.min(1, Math.max(0, t));
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].at) {
      const a = stops[i - 1], b = stops[i];
      const f = (t - a.at) / (b.at - a.at || 1);
      const [ca, cb] = [hex(a.color), hex(b.color)];
      return '#' + ca.map((v, k) => Math.round(v + (cb[k] - v) * f).toString(16).padStart(2, '0')).join('');
    }
  }
  return stops.at(-1).color;
}

// ---------- colours ----------
export const hexToRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export const mixColors = (cols) => rgbToHex([0, 1, 2].map((k) => cols.reduce((a, c) => a + hexToRgb(c)[k], 0) / cols.length));
export const colorDistance = (a, b) => Math.hypot(...hexToRgb(a).map((v, k) => v - hexToRgb(b)[k]));

/**
 * Colour of a gene. colors = { nodes: {listId: hex}, edges, shared: {mode, custom} }.
 * Genes in more than one list are "shared": mode 'first' -> colour of their first list,
 * 'mixed' -> average of their lists' colours, 'custom' -> user colour (one for all, or per gene).
 */
export function nodeColor(node, colors) {
  const base = node.lists.map((l) => colors.nodes[l] || '#999999');
  if (node.lists.length < 2 || !colors.shared) return base[0];
  const { mode, custom } = colors.shared;
  if (mode === 'mixed') return mixColors(base);
  if (mode === 'custom') {
    const c = custom.grouping === 'individual' ? custom.genes[node.id] ?? custom.all : custom.all;
    if (c) return c;
  }
  return base[0];
}

/** Colours that may not be given to `target` ('shared' | 'nodes' | 'edges'): lists and shared genes never share one. */
export function reservedColors(target, colors) {
  if (target === 'shared') return Object.values(colors.nodes);
  if (target === 'nodes' && colors.shared?.mode === 'custom') {
    const { grouping, all, genes } = colors.shared.custom;
    return (grouping === 'individual' ? [...Object.values(genes), all] : [all]).filter(Boolean);
  }
  return [];
}
/** Tolerance so that near-identical colours (e.g. from the free colour picker) count as the same. */
export const isReserved = (hex, reserved) => reserved.some((r) => colorDistance(hex, r) < 12);
