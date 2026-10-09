import { forceCollide, forceSimulation, forceX, forceY } from 'd3';

export const FOCUS_SCALE = 1.8;   // the located gene grows to this many times its normal size

/**
 * Make room around fixed `anchors` ([{x, y, r}]): the genes in `nodes` ([{x, y, r}]) near `centre` are pushed
 * outward just enough not to overlap them, and the push fades with distance (a short collision relaxation;
 * far genes stay put). Returns Map(node -> {x, y}) of the genes that actually move.
 */
export function relax(nodes, anchors, centre, reach, { gap = 3 } = {}) {
  const near = nodes.filter((n) => Math.hypot(n.x - centre.x, n.y - centre.y) < reach);
  const sim = [...anchors.map((a) => ({ x: a.x, y: a.y, fx: a.x, fy: a.y, r: a.r })),
    ...near.map((n) => {
      const outer = Math.hypot(n.x - centre.x, n.y - centre.y) > reach * 0.6;   // the outer ring only blocks
      return { n, x: n.x, y: n.y, ox: n.x, oy: n.y, r: n.r, fx: outer ? n.x : undefined, fy: outer ? n.y : undefined };
    })];
  forceSimulation(sim)
    .force('collide', forceCollide((d) => d.r + gap).strength(1).iterations(4))
    .force('x', forceX((d) => d.ox ?? d.x).strength(0.03))
    .force('y', forceY((d) => d.oy ?? d.y).strength(0.03))
    .stop().tick(60);
  const moved = new Map();
  for (const d of sim.slice(anchors.length)) if (Math.hypot(d.x - d.ox, d.y - d.oy) > 0.5) moved.set(d.n, { x: d.x, y: d.y });
  return moved;
}

/** The gene `centre` grows to `radius`: its neighbours move aside to make room. */
export const pushAside = (nodes, centre, radius, opts = {}) =>
  relax(nodes.filter((n) => n !== centre), [{ x: centre.x, y: centre.y, r: radius }], centre, radius * 5, opts);

/**
 * Slots for `count` genes pulled around `centre`: concentric rings, innermost first, each ring as full as
 * its circumference allows with `r`-sized genes. Returns [{x, y, ring, angle}] (the first slots are the closest).
 */
export function ringSlots(centre, count, r, { gap = 5, inner = 2 * r + 10 } = {}) {
  const slots = [];
  for (let ring = 0, radius = inner; slots.length < count; ring++, radius += 2 * r + gap + 2) {
    const fit = Math.max(1, Math.floor((2 * Math.PI * radius) / (2 * r + gap)));
    const n = Math.min(fit, count - slots.length);
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n + ring * 0.5;   // each ring is turned a little so spokes do not line up
      slots.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle), ring, angle });
    }
  }
  return slots;
}

/**
 * Pull `neighbours` ([{x, y, r}], strongest first) around `centre`: the strongest take the inner ring, and inside a
 * ring each gene takes the slot nearest the direction it already lies in (so the pull stays short and tidy).
 * Returns Map(gene -> {x, y}).
 */
export function pullAround(centre, neighbours, r) {
  const slots = ringSlots(centre, neighbours.length, r);
  const angularGap = (a, b) => Math.abs((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  const out = new Map();
  for (let from = 0; from < slots.length;) {
    let to = from;
    while (to < slots.length && slots[to].ring === slots[from].ring) to++;
    const free = new Set(slots.slice(from, to));
    for (const n of neighbours.slice(from, to)) {
      const a = Math.atan2(n.y - centre.y, n.x - centre.x);
      let best = null;
      for (const s of free) if (!best || angularGap(s.angle, a) < angularGap(best.angle, a)) best = s;
      free.delete(best);
      out.set(n, { x: best.x, y: best.y });
    }
    from = to;
  }
  return out;
}
