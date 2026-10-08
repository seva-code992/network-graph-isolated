// Pure model behind the palette view: gene/list/edge "boxes" that sit on a palette colour (or in the
// tray when unplaced). Several items can share one box = one colour. All functions return new arrays.
let seq = 0;
const nid = () => ++seq;
export const norm = (c) => (c || '').toLowerCase();
const clone = (gs) => gs.map((g) => ({ ...g, keys: [...g.keys] }));

/** Items whose current colour is a swatch of the palette start on it (sharing a box); the rest start in the tray. */
export function initGroups(items, swatches) {
  const sw = new Set(swatches.map(norm));
  const byColor = new Map();
  const groups = [];
  for (const it of items) {
    const c = norm(it.get());
    if (sw.has(c)) {
      let g = byColor.get(c);
      if (!g) groups.push((g = { id: nid(), keys: [], color: c })), byColor.set(c, g);
      g.keys.push(it.key);
    } else groups.push({ id: nid(), keys: [it.key], color: null });
  }
  return groups;
}

const without = (groups, key) => groups
  .map((g) => ({ ...g, keys: g.keys.filter((k) => k !== key) })).filter((g) => g.keys.length);

/** Drop a whole box on a colour. Joins the box already there, if any. -> {groups, keys, color} (keys to recolour) */
export function placeOnColor(groups, id, hex) {
  const gs = clone(groups), g = gs.find((x) => x.id === id), color = norm(hex);
  const other = gs.find((x) => x.id !== id && x.color === color);
  if (other) { other.keys.push(...g.keys); return { groups: gs.filter((x) => x !== g), keys: g.keys, color }; }
  g.color = color;
  return { groups: gs, keys: g.keys, color };
}

/** Drop box `srcId` on box `targetId`: they merge and take the target's colour. */
export function mergeGroups(groups, srcId, targetId) {
  if (srcId === targetId) return { groups, keys: [], color: null };
  const gs = clone(groups), src = gs.find((x) => x.id === srcId), t = gs.find((x) => x.id === targetId);
  t.keys.push(...src.keys);
  return { groups: gs.filter((x) => x !== src), keys: src.keys, color: t.color };
}

/** Drag one name out of a box onto a colour. */
export function placeKeyOnColor(groups, key, hex) {
  const gs = [...without(groups, key), { id: nid(), keys: [key], color: null }];
  return placeOnColor(gs, gs.at(-1).id, hex);
}

/** Drag one name onto another box. */
export function moveKeyToGroup(groups, key, targetId) {
  const gs = clone(without(groups, key));
  const t = gs.find((x) => x.id === targetId);
  t.keys.push(key);
  return { groups: gs, keys: [key], color: t.color };
}

/** Drag a name away from its box: it gets a box of its own in the tray (its graph colour is unchanged until it is dropped on a colour). */
export function detachKey(groups, key) {
  const g = groups.find((x) => x.keys.includes(key));
  if (g && g.keys.length === 1) return clone(groups).map((x) => (x.id === g.id ? { ...x, color: null } : x));
  return [...without(groups, key), { id: nid(), keys: [key], color: null }];
}

export const unplace = (groups, id) => clone(groups).map((g) => (g.id === id ? { ...g, color: null } : g));
