import { h, makeDraggable } from './dom.js';

const KEY = 'ng.skipDeleteConfirm';
export const deleteConfirmSkipped = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const rememberSkip = () => { try { localStorage.setItem(KEY, '1'); } catch { /* the question is just asked again next time */ } };

/**
 * "Delete these genes?" window (movable). Resolves true when confirmed, false when cancelled.
 * The "Do not ask again" box is remembered in the browser.
 */
export function confirmDeleteGenes(ids, parent = document.body) {
  return new Promise((resolve) => {
    const never = h('input', { type: 'checkbox', id: 'ng-never-ask' });
    const done = (ok) => {
      if (ok && never.checked) rememberSkip();
      drag.destroy(); document.removeEventListener('keydown', onKey, true); root.remove(); resolve(ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    const what = ids.length === 1 ? `gene ${ids[0]}` : `${ids.length} genes`;
    const card = h('div', { class: 'card confirm-box' },
      h('h2', { class: 'confirm-title', title: 'Drag to move this window' }, ids.length === 1 ? 'Delete gene?' : 'Delete genes?'),
      h('p', { class: 'confirm-text' }, `Delete ${what} from the graph? ${ids.length === 1 ? 'It is' : 'They are'} also unselected in the gene selection (see "Change selection").`),
      ids.length > 1 && h('div', { class: 'confirm-ids' }, ids.join(', ')),
      h('label', { class: 'confirm-never' }, never, ' Do not ask again'),
      h('div', { class: 'confirm-actions' },
        h('button', { class: 'pill', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'pill primary', onclick: () => done(true) }, 'Delete')));
    const root = h('div', { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Confirm deletion' }, card);
    const drag = makeDraggable(root, () => card);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) done(false); });
    document.addEventListener('keydown', onKey, true);
    parent.append(root);
    card.querySelector('.pill.primary').focus();
  });
}
