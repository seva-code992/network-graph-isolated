import { h, clear } from './dom.js';
import { createCustomize } from './customize.js';
import { buildColorModes } from './colorModes.js';
import { freeColor } from './palettes.js';
import { isReserved } from './logic.js';

const OPTIONS = [
  ['first', 'Color of the first list', 'Shared genes get the colour of the first list they belong to (in selector order)'],
  ['mixed', 'Mixed color', 'Shared genes get the average colour of all the lists they belong to'],
  ['custom', 'Custom', 'Choose the colour(s) of the shared genes yourself'],
];

/**
 * "Information box" shown before the graph is generated when genes occur in several lists.
 * Mutates colors.shared; onContinue() is called when the user has chosen.
 */
export function createSharedDialog({ colors, lists, sharedGenes, onContinue, onBack }) {
  const root = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Information box' });
  const modes = buildColorModes({ colors, lists, sharedGenes, only: ['shared-all', 'shared-individual'],
    labels: { 'shared-all': 'All shared', 'shared-individual': 'Individually' } });
  const customize = createCustomize({ ...modes, onChange: () => {}, dismissOnOutside: false, title: 'Customize shared genes' });
  const nameOf = new Map(lists.map((l) => [l.id, l.name]));

  function choose(mode) {
    colors.shared.mode = mode;
    if (mode === 'custom') {
      const c = colors.shared.custom;
      // start from a free colour (one no list uses) so there is always a valid choice
      c.all ??= freeColor(Object.values(colors.nodes), isReserved);
      customize.setMode(c.grouping === 'individual' ? 'shared-individual' : 'shared-all');
      customize.open();
    } else {
      customize.close();
    }
  }

  const radios = OPTIONS.map(([value, label, tip]) => h('label', { class: 'radio', title: tip },
    h('input', { type: 'radio', name: 'shared-mode', value, checked: colors.shared.mode === value,
      onchange: () => choose(value) }), h('span', {}, label)));

  const card = h('div', { class: 'card shared-dialog' },
    h('button', { class: 'link back', onclick: onBack, title: 'Go back to the selector' }, '← Back'),
    h('h2', { class: 'shared-title' }, 'Information box'),
    h('p', { class: 'shared-lead' }, `Common genes have been detected (${sharedGenes.length}) — they appear in more than one selected list:`),
    h('div', { class: 'shared-grid' },
      h('div', { class: 'shared-table' },
        h('div', { class: 'shared-head' }, h('span', {}, 'Gene ID:'), h('span', {}, 'Lists:')),
        h('div', { class: 'shared-rows' }, sharedGenes.map((g) => h('div', { class: 'shared-row' },
          h('span', { class: 'gene-id' }, g.id),
          h('span', { class: 'shared-lists', title: g.lists.map((l) => nameOf.get(l) ?? l).join(', ') },
            g.lists.map((l) => nameOf.get(l) ?? l).join(', ')))))),
      h('div', { class: 'shared-options' }, h('div', { class: 'shared-head' }, 'Options:'),
        h('div', { class: 'options-box', role: 'radiogroup', 'aria-label': 'Color of the shared genes' }, radios))),
    h('div', { class: 'shared-foot' },
      h('span', { class: 'shared-hint' }, 'Please choose an option to decide the color of the shared genes to generate the graph.'),
      h('button', { class: 'btn-small', onclick: onContinue }, 'Continue')));

  root.append(h('div', { class: 'shared-stack' }, card, customize.el));
  if (colors.shared.mode === 'custom') customize.open();
  return { el: root, destroy: () => root.remove() };
}
