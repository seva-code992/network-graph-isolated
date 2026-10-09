// Community detection (Louvain modularity optimisation) – deterministic, no randomness.

/**
 * @param n          number of nodes (0..n-1)
 * @param links      [{source, target, weight}] undirected
 * @param resolution >1 gives more / smaller communities
 * @returns Int32Array community id (0..k-1) per node
 */
export function louvain(n, links, resolution = 1) {
  let adj = Array.from({ length: n }, () => new Map());
  for (const { source: a, target: b, weight: w } of links) {
    if (a === b || !(w > 0)) continue;
    adj[a].set(b, (adj[a].get(b) || 0) + w);
    adj[b].set(a, (adj[b].get(a) || 0) + w);
  }
  let member = Int32Array.from({ length: n }, (_, i) => i); // original node -> node of the current level

  for (let level = 0; level < 20; level++) {
    const size = adj.length;
    const k = adj.map((m) => { let s = 0; for (const w of m.values()) s += w; return s; });
    const twoM = k.reduce((a, b) => a + b, 0);
    if (twoM === 0) break;
    const comm = Int32Array.from({ length: size }, (_, i) => i);
    const tot = Float64Array.from(k);
    let moved = false;
    for (let pass = 0; pass < 50; pass++) {
      let improved = false;
      for (let i = 0; i < size; i++) {
        const ci = comm[i], nw = new Map();
        for (const [j, w] of adj[i]) if (j !== i) nw.set(comm[j], (nw.get(comm[j]) || 0) + w);
        tot[ci] -= k[i];
        let best = ci, bestGain = (nw.get(ci) || 0) - (resolution * tot[ci] * k[i]) / twoM;
        for (const [c, w] of nw) {
          const gain = w - (resolution * tot[c] * k[i]) / twoM;
          if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
        }
        tot[best] += k[i];
        if (best !== ci) { comm[i] = best; improved = moved = true; }
      }
      if (!improved) break;
    }
    if (!moved) break;
    // aggregate: one node per community
    const ids = new Map();
    for (const c of comm) if (!ids.has(c)) ids.set(c, ids.size);
    const next = Array.from({ length: ids.size }, () => new Map());
    for (let i = 0; i < size; i++) {
      const a = ids.get(comm[i]);
      for (const [j, w] of adj[i]) { const b = ids.get(comm[j]); next[a].set(b, (next[a].get(b) || 0) + w); }
    }
    member = member.map((m) => ids.get(comm[m]));
    adj = next;
    if (ids.size === size) break;
  }
  // renumber 0..k-1 in order of first appearance
  const out = new Int32Array(n), seen = new Map();
  member.forEach((m, i) => { if (!seen.has(m)) seen.set(m, seen.size); out[i] = seen.get(m); });
  return out;
}

/**
 * Genes with none of the given links share one group (instead of one group each); group ids are renumbered
 * 0..k-1 with no gaps (the layout indexes its groups by id).
 */
export function groupUnlinked(comm, links) {
  const linked = new Uint8Array(comm.length);
  for (const l of links) { linked[l.source] = 1; linked[l.target] = 1; }
  const ids = new Map(), out = new Int32Array(comm.length);
  const loose = 'loose';
  comm.forEach((c, i) => {
    const key = linked[i] ? c : loose;
    if (!ids.has(key)) ids.set(key, ids.size);
    out[i] = ids.get(key);
  });
  return out;
}
