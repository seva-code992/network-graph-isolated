import test from 'node:test';
import assert from 'node:assert/strict';
import { binOf, edgeWidth, visibleEdges, geneStats, rank, matrixTsv, gradientColor, BINS,
  nodeColor, mixColors, reservedColors, isReserved } from '../src/logic.js';
import { buildColorModes, defaultShared } from '../src/colorModes.js';
import { randomNodeColors, PALETTES } from '../src/palettes.js';

const nodes = [
  { id: 'a', lists: ['L1'] }, { id: 'b', lists: ['L2'] }, { id: 'c', lists: ['L1', 'L2'] }, { id: 'd', lists: ['L2'] },
];
const edges = [
  { source: 'a', target: 'b', score: 0.9, type: 'annotation' },
  { source: 'a', target: 'c', score: 0.5, type: 'expression' },
  { source: 'b', target: 'd', score: 0.7, type: 'expression' },
];

test('bins are monotonic and cover 0..1', () => {
  assert.equal(binOf(0.01), 0); assert.equal(binOf(0.25), 1); assert.equal(binOf(0.74), 2);
  assert.equal(binOf(1), 3);
  assert.ok(edgeWidth(0.9) > edgeWidth(0.1));
});

test('threshold is strictly greater-than', () => {
  assert.equal(visibleEdges(nodes, edges, 0.7, new Set()).length, 1);
  assert.equal(visibleEdges(nodes, edges, 0.5, new Set()).length, 2);
  assert.equal(visibleEdges(nodes, edges, 0, new Set()).length, 3);
});

test('hiding a list hides its genes and their edges; shared genes stay', () => {
  const v = visibleEdges(nodes, edges, 0, new Set(['L2']));
  assert.deepEqual(v.map((e) => e.target), ['c']); // a-c survives (c is also in L1)
});

test('stats: degree and score sum, no zeros', () => {
  const s = Object.fromEntries(geneStats(edges).map((x) => [x.id, x]));
  assert.equal(s.a.degree, 2); assert.equal(s.a.sum, 1.4);
  assert.equal(s.b.sum, 1.6);
  assert.ok(!('z' in s));
});

test('rank: collapsed uses fit, expanded keeps ties with the 10th', () => {
  const stats = Array.from({ length: 14 }, (_, i) => ({ id: 'g' + String(i).padStart(2, '0'), degree: i < 9 ? 20 - i : i < 12 ? 5 : 3, sum: 0 }));
  // values: 20..12 (9 genes), then 3 genes with 5, then 2 with 3
  assert.equal(rank(stats, 'degree', { expanded: false, fit: 4 }).length, 4);
  const exp = rank(stats, 'degree', { expanded: true, fit: 4 });
  assert.equal(exp.length, 12); // 10th value is 5 -> all three 5s included, the 3s excluded
  assert.equal(rank(stats, 'sum', { expanded: true, fit: 4 }).length, 0); // zero scores never shown
});

test('rank: fewer than 10 non-zero genes', () => {
  const stats = [{ id: 'x', degree: 2, sum: 1 }, { id: 'y', degree: 0, sum: 0 }];
  assert.deepEqual(rank(stats, 'degree', { expanded: true, fit: 3 }).map((s) => s.id), ['x']);
});

test('matrix tsv is symmetric', () => {
  const t = matrixTsv(nodes, edges).trim().split('\n').map((l) => l.split('\t'));
  assert.equal(t[0].join(), 'gene,a,b,c,d');
  assert.equal(t[1][2], '0.9'); assert.equal(t[2][1], '0.9');
});

test('gradient endpoints', () => {
  const stops = [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }];
  assert.equal(gradientColor(stops, 0), '#ff0000'); assert.equal(gradientColor(stops, 1), '#0000ff');
});

test('random node colours come from the default palette without repeats', () => {
  const c = randomNodeColors(['a', 'b', 'c']);
  assert.equal(new Set(Object.values(c)).size, 3);
  assert.ok(Object.values(c).every((x) => PALETTES[0].colors.includes(x)));
});

test('line widths follow the Figma values: 0.5px for score 1, 0.1px thinnest', () => {
  assert.deepEqual(BINS.map((b) => b.width), [0.1, 0.18, 0.35, 0.5]);
  assert.equal(edgeWidth(1), 0.5); assert.equal(edgeWidth(0.1), 0.1);
});

const colors = () => ({ nodes: { L1: '#ff0000', L2: '#0000ff', L3: '#00ff00' }, edges: {}, shared: defaultShared() });
const shared = { id: 'g', lists: ['L1', 'L2'] };

test('shared gene colour: first list / mixed / custom (all or individually)', () => {
  const c = colors();
  assert.equal(nodeColor({ id: 'x', lists: ['L2'] }, c), '#0000ff');   // not shared: own list
  assert.equal(nodeColor(shared, c), '#ff0000');                         // first
  c.shared.mode = 'mixed';
  assert.equal(nodeColor(shared, c), mixColors(['#ff0000', '#0000ff']));
  c.shared.mode = 'custom'; c.shared.custom.all = '#123456';
  assert.equal(nodeColor(shared, c), '#123456');
  c.shared.custom.grouping = 'individual'; c.shared.custom.genes.g = '#abcdef';
  assert.equal(nodeColor(shared, c), '#abcdef');
  assert.equal(nodeColor({ id: 'h', lists: ['L1', 'L3'] }, c), '#123456'); // falls back to the "all" colour
});

test('mixed colour is the RGB average', () => {
  assert.equal(mixColors(['#ff0000', '#0000ff']), '#800080');
});

test('lists and shared genes cannot use the same colour (both directions, with tolerance)', () => {
  const c = colors();
  const m = buildColorModes({ colors: c, lists: [{ id: 'L1' }, { id: 'L2' }], sharedGenes: [shared] });
  assert.equal(m.isBlocked('shared-all', '#ff0000'), true);
  assert.equal(m.isBlocked('shared-individual', '#fe0202'), true);   // visually identical
  assert.equal(m.isBlocked('shared-all', '#123456'), false);
  assert.equal(m.isBlocked('edges', '#ff0000'), false);
  assert.equal(m.isBlocked('nodes', '#123456'), false);              // shared not custom yet
  m.getItems('shared-all')[0].set('#123456');                         // choosing a colour switches to custom
  assert.equal(c.shared.mode, 'custom');
  assert.equal(m.isBlocked('nodes', '#123456'), true);               // now unavailable to the lists
  assert.ok(isReserved('#123456', reservedColors('nodes', c)));
});

test('customize modes: shared entries only when shared genes exist', () => {
  const c = colors();
  const none = buildColorModes({ colors: c, lists: [], sharedGenes: [] }).getModes().map((x) => x.id);
  assert.deepEqual(none, ['nodes', 'edges']);
  const some = buildColorModes({ colors: c, lists: [], sharedGenes: [shared] }).getModes().map((x) => x.id);
  assert.deepEqual(some, ['nodes', 'edges', 'shared-all', 'shared-individual']);
  const items = buildColorModes({ colors: c, lists: [], sharedGenes: [shared, { id: 'k', lists: ['L1', 'L3'] }] }).getItems('shared-individual');
  assert.deepEqual(items.map((i) => i.label), ['g', 'k']);
});
