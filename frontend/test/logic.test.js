import test from 'node:test';
import assert from 'node:assert/strict';
import { binOf, edgeWidth, visibleEdges, geneStats, rank, matrixTsv, gradientColor } from '../src/logic.js';
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
