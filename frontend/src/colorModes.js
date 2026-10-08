import { isReserved, nodeColor, reservedColors } from './logic.js';

export const defaultShared = () => ({ mode: 'first', custom: { grouping: 'all', all: null, genes: {} } });

/**
 * What the customize box can colour. colors = { nodes, edges, shared } is mutated in place.
 *   lists        [{id, name}]
 *   sharedGenes  [{id, lists: [listId]}]
 *   labels       texts of the drop-down entries
 *   only         restrict to some modes (the pre-graph dialog only offers the shared ones)
 */
export function buildColorModes({ colors, lists, sharedGenes, labels = {}, only }) {
  const L = { nodes: 'nodes', edges: 'edges', 'shared-all': 'shared genes (all)',
    'shared-individual': 'shared genes (individually)', ...labels };
  const toCustom = (grouping) => { colors.shared.mode = 'custom'; colors.shared.custom.grouping = grouping; };

  const items = {
    nodes: () => lists.map((l) => ({ key: l.id, label: l.name, get: () => colors.nodes[l.id], set: (c) => { colors.nodes[l.id] = c; } })),
    edges: () => ['annotation', 'expression'].map((k) => ({ key: k, label: k === 'annotation' ? 'annotations' : 'expression',
      get: () => colors.edges[k], set: (c) => { colors.edges[k] = c; } })),
    'shared-all': () => [{ key: 'all', label: 'shared genes',
      get: () => colors.shared.custom.all ?? nodeColor(sharedGenes[0], colors),
      set: (c) => { toCustom('all'); colors.shared.custom.all = c; } }],
    'shared-individual': () => sharedGenes.map((g) => ({ key: g.id, label: g.id, get: () => nodeColor(g, colors),
      set: (c) => { toCustom('individual'); colors.shared.custom.genes[g.id] = c; } })),
  };
  const available = () => ['nodes', 'edges', ...(sharedGenes.length ? ['shared-all', 'shared-individual'] : [])]
    .filter((id) => !only || only.includes(id));

  return {
    getModes: () => available().map((id) => ({ id, label: L[id] })),
    getItems: (id) => items[id](),
    // lists and shared genes never use the same colour
    isBlocked: (id, hex) => isReserved(hex, reservedColors(id.startsWith('shared') ? 'shared' : id, colors)),
  };
}
