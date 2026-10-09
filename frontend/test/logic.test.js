import test from 'node:test';
import assert from 'node:assert/strict';
import { binOf, edgeWidth, visibleEdges, geneStats, rank, matrixTsv, gradientColor, BINS,
  nodeColor, mixColors, reservedColors, isReserved } from '../src/logic.js';
import { buildColorModes, defaultShared } from '../src/colorModes.js';
import * as G from '../src/groups.js';
import { louvain } from '../src/cluster.js';
import { hsvToRgb, rgbToHsv, rgbToHsl, hslToRgb, toHex, parseHex } from '../src/colorPicker.js';
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

// ---- palette view model ----
const SW = ['#6DFD9D', '#6DE7FD', '#FDF16D'];
const itm = (key, color) => ({ key, get: () => color });

test('groups: items already on a swatch share its box, others start in the tray', () => {
  const g = G.initGroups([itm('a', '#6dfd9d'), itm('b', '#6DFD9D'), itm('c', '#123456')], SW);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].keys, ['a', 'b']); assert.equal(g[0].color, '#6dfd9d');
  assert.deepEqual(g[1].keys, ['c']); assert.equal(g[1].color, null);
});

test('groups: dropping boxes on the same colour merges them (same colour for all)', () => {
  let gs = G.initGroups([itm('a', 'x'), itm('b', 'x'), itm('c', 'x')], SW);
  const [A, B, C] = gs.map((g) => g.id);
  let r = G.placeOnColor(gs, A, '#6DE7FD'); gs = r.groups;
  assert.deepEqual(r.keys, ['a']);
  r = G.placeOnColor(gs, B, '#6DE7FD'); gs = r.groups;
  assert.equal(gs.length, 2); assert.deepEqual(gs.find((g) => g.color).keys, ['a', 'b']);
  r = G.mergeGroups(gs, C, gs.find((g) => g.color).id);                 // box on box
  assert.equal(r.color, '#6de7fd'); assert.deepEqual(r.keys, ['c']);
  assert.deepEqual(r.groups[0].keys, ['a', 'b', 'c']);
});

test('groups: dragging a name out of a merged box gives it its own box in the tray', () => {
  const gs = G.initGroups([itm('a', '#6DFD9D'), itm('b', '#6DFD9D')], SW);
  const out = G.detachKey(gs, 'b');
  assert.deepEqual(out.find((g) => g.color).keys, ['a']);
  assert.deepEqual(out.find((g) => !g.color).keys, ['b']);
  const sole = G.detachKey(G.initGroups([itm('a', '#6DFD9D')], SW), 'a');   // a lone box is simply unplaced
  assert.equal(sole.length, 1); assert.equal(sole[0].color, null);
  const r = G.placeKeyOnColor(gs, 'b', '#FDF16D');
  assert.deepEqual(r.keys, ['b']); assert.equal(r.groups.length, 2);
  const m = G.moveKeyToGroup(gs, 'b', gs[0].id); assert.deepEqual(m.groups[0].keys, ['a', 'b']);
});

// ---- picker maths ----
test('colour conversions round-trip', () => {
  assert.deepEqual(hsvToRgb({ h: 0, s: 1, v: 1 }), [255, 0, 0]);
  assert.deepEqual(hsvToRgb({ h: 200, s: 0.5, v: 0.5 }), hsvToRgb(rgbToHsv(hsvToRgb({ h: 200, s: 0.5, v: 0.5 }))));
  for (const rgb of [[109, 231, 253], [0, 0, 0], [255, 255, 255], [18, 52, 86]]) {
    hslToRgb(rgbToHsl(rgb)).forEach((v, k) => assert.ok(Math.abs(v - rgb[k]) <= 2)); // HSL is shown in whole numbers
    assert.deepEqual(hsvToRgb(rgbToHsv(rgb)), rgb);
  }
  assert.equal(toHex([109, 231, 253]), '#6de7fd');
  assert.equal(toHex([109, 231, 253], 0.5), '#6de7fd80');
});

test('hex parsing accepts 3/6/8 digits and rejects junk', () => {
  assert.deepEqual(parseHex('#6DE7FD'), { rgb: [109, 231, 253], a: 1 });
  assert.deepEqual(parseHex('fff').rgb, [255, 255, 255]);
  assert.ok(Math.abs(parseHex('#00000080').a - 0.5) < 0.01);
  assert.equal(parseHex('#12'), null); assert.equal(parseHex('zzzzzz'), null);
});

test('colours with opacity still compare by their rgb part', () => {
  assert.ok(isReserved('#ff000080', ['#ff0000']));
  assert.equal(mixColors(['#ff000080', '#0000ff']), '#800080');
});

// ---- grouping ----
const clique = (ids, w = 0.9) => ids.flatMap((a, i) => ids.slice(i + 1).map((b) => ({ source: a, target: b, weight: w })));

test('louvain: separates groups of strongly connected genes joined by weak links', () => {
  const links = [...clique([0, 1, 2, 3, 4]), ...clique([5, 6, 7, 8, 9]), { source: 4, target: 5, weight: 0.1 }];
  const c = louvain(10, links);
  assert.equal(new Set(c).size, 2);
  assert.ok([0, 1, 2, 3, 4].every((i) => c[i] === c[0]) && [5, 6, 7, 8, 9].every((i) => c[i] === c[5]) && c[0] !== c[5]);
});

test('louvain: isolated genes stay on their own, result is deterministic and ids are 0..k-1', () => {
  const links = clique([0, 1, 2]);
  const c = louvain(5, links);
  assert.equal(c[3] !== c[4] && c[3] !== c[0], true);
  assert.deepEqual([...louvain(5, links)], [...c]);
  assert.deepEqual([...new Set(c)].sort(), [0, 1, 2]);
  assert.equal(louvain(3, []).length, 3);
});
