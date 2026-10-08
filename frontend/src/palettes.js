// The first palette is the default one (ColorBrewer "Paired" – the colours used in the design).
export const PALETTES = [
  { id: 'paired', name: 'Paired',
    colors: ['#A6CEE3', '#1F78B4', '#B2DF8A', '#33A02C', '#FB9A99', '#E31A1C',
             '#FDBF6F', '#FF7F00', '#CAB2D6', '#6A3D9A', '#FFFF99', '#B15928'] },
  { id: 'tableau10', name: 'Tableau 10',
    colors: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
             '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'] },
  { id: 'viridis', name: 'Viridis',
    colors: ['#440154', '#46337E', '#365C8D', '#277F8E', '#1FA187', '#4AC16D', '#9FDA3A', '#FDE725'] },
];

export const DEFAULT_EDGE_COLORS = { annotation: '#000000', expression: '#3885F5' };

/** Random colour per list from the default palette (no repeats until the palette runs out). */
export function randomNodeColors(listIds, rng = Math.random) {
  const pool = [...PALETTES[0].colors];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Object.fromEntries(listIds.map((id, i) => [id, pool[i % pool.length]]));
}

/** First palette colour that is not in `reserved` (see logic.isReserved). */
export function freeColor(reserved, isReserved) {
  return PALETTES.flatMap((p) => p.colors).find((c) => !isReserved(c, reserved)) ?? '#888888';
}
