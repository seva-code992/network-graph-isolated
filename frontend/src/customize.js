import { h, clear, onOutsideClick, makeDraggable } from './dom.js';
import { PALETTES } from './palettes.js';
import { createColorPicker } from './colorPicker.js';
import * as G from './groups.js';

const HUE_GRADIENT = 'linear-gradient(180deg, #FF8000 0%, #F7FF01 22.12%, #02F986 39.9%, #00EEFF 58.65%, #9100FF 83.17%, #FF0004 100%)';
const BLOCKED_TIP = 'This colour is already used by another group of nodes — choose a different one';

/**
 * Customize box. Three screens that swap in place: home (palettes + colour picker), palette
 * (drag boxes onto colours) and colour picker (select an item, pick a colour). Changes apply immediately.
 *
 * getModes()         -> [{id, label}]            entries of the drop-down (e.g. nodes / edges)
 * getItems(modeId)   -> [{key, label, get(), set(hex)}]   the things that can be coloured
 * isBlocked(modeId, hex) -> true when that colour must not be used (greyed out / refused)
 * onChange(modeId)   called after every applied colour
 * dismissOnOutside   hide on a click outside (graph page) – false when embedded in a dialog
 */
export function createCustomize({ getModes, getItems, isBlocked = () => false, onChange, ignoreOutside = [],
  dismissOnOutside = true, title = 'Customize your graph' }) {
  const st = { mode: null, view: 'home', palette: 0, target: null, msg: '', groups: null };
  const root = h('div', { class: 'customize', hidden: true, role: 'dialog', 'aria-label': title });
  let dispose = () => {};
  let footEl = null;
  makeDraggable(root, () => root, { handle: '.customize-head, .customize-hint' });   // move the box by its title row

  const mode = () => {
    const modes = getModes();
    if (!modes.some((m) => m.id === st.mode)) st.mode = modes[0].id;
    return st.mode;
  };
  const flash = (text) => { st.msg = text; if (footEl) { footEl.textContent = text || DEFAULT_HINT[st.view]; footEl.classList.toggle('warn-text', !!text); } };
  const go = (view, palette = st.palette) => { st.view = view; st.palette = palette; st.groups = null; st.msg = ''; render(); };

  /** Recolour items; refuses colours reserved for someone else. */
  function assign(keys, hex) {
    const m = mode();
    if (isBlocked(m, hex)) { flash(BLOCKED_TIP + '.'); return false; }
    flash('');
    getItems(m).filter((i) => keys.includes(i.key)).forEach((i) => i.set(hex));
    onChange(m);
    return true;
  }

  const DEFAULT_HINT = {
    home: 'Choose a palette, or the colour picker, to colour your selection.',
    palette: 'Drag a box onto a colour. Drop boxes on each other to give them the same colour; drag a name out of a box to separate it.',
    picker: 'Select a name, then pick its colour.',
  };

  // ---------- home ----------
  function homeView() {
    const cards = PALETTES.map((p, i) => h('button', { class: 'palette-card', title: `Open the ${p.name} palette`, onclick: () => go('palette', i) },
      h('span', { class: 'palette-name' }, p.name),
      h('span', { class: 'mini-swatches' }, p.colors.map((c) => h('span', { class: 'mini', style: { background: c } })))));
    return h('div', { class: 'customize-body' },
      h('section', { class: 'cust-panel palettes-panel' }, h('h4', {}, 'Available palettes'), h('div', { class: 'palettes' }, cards)),
      h('section', { class: 'cust-panel picker-panel' }, h('h4', {}, 'Color picker'),
        h('button', { class: 'picker-card', title: 'Open the colour picker', 'aria-label': 'Open the colour picker', onclick: () => go('picker') },
          h('span', { class: 'rainbow', style: { background: HUE_GRADIENT } }))));
  }

  // ---------- palette view ----------
  function paletteView(items) {
    const palette = PALETTES[st.palette];
    const label = new Map(items.map((i) => [i.key, i.label]));
    st.groups ??= G.initGroups(items, palette.colors);
    let drag = null, handled = false;
    const apply = (res) => {            // res = {groups, keys, color}
      handled = true;
      if (res.color && !assign(res.keys, res.color)) { render(); return; }
      st.groups = res.groups;
      render();
    };
    const payload = (e, data) => { drag = data; handled = false; e.dataTransfer.setData('text/plain', 'x'); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); };
    const over = (e) => { if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } };

    const names = (g) => h('div', { class: 'gbox-names' }, g.keys.flatMap((k, i) => [
      i ? ', ' : null,
      h('span', { class: 'gname', draggable: true, title: `${label.get(k)} — drag it out of the box to separate it, or onto a colour`,
        ondragstart: (e) => payload(e, { t: 'key', key: k, from: g.id }),
        ondragend: () => { if (drag && !handled) { st.groups = G.detachKey(st.groups, drag.key); drag = null; render(); } else drag = null; } }, label.get(k)),
    ]));
    const box = (g) => h('div', { class: 'gbox', draggable: true, title: 'Drag onto a colour (or onto another box to merge)',
      ondragstart: (e) => payload(e, { t: 'group', id: g.id }),
      ondragend: () => { if (drag && !handled && drag.t === 'group') { st.groups = G.unplace(st.groups, drag.id); render(); } drag = null; },
      ondragover: over,
      ondrop: (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!drag) return;
        if (drag.t === 'group') apply(G.mergeGroups(st.groups, drag.id, g.id));
        else if (drag.from === g.id) handled = true;
        else apply(G.moveKeyToGroup(st.groups, drag.key, g.id));
      } });
    const cell = (g, inner) => h('div', { class: 'gcell' }, g ? names(g) : h('div', { class: 'gbox-names' }), inner);

    const tray = h('div', { class: 'tray', ondragover: over,
      ondrop: (e) => { e.preventDefault(); if (drag?.t === 'key') { st.groups = G.detachKey(st.groups, drag.key); handled = true; render(); } else if (drag?.t === 'group') { st.groups = G.unplace(st.groups, drag.id); handled = true; render(); } } },
    st.groups.filter((g) => !g.color).map((g) => cell(g, box(g))));

    const swatches = h('div', { class: 'palette-grid' }, palette.colors.map((c) => {
      const g = st.groups.find((x) => x.color === c.toLowerCase());
      const blocked = isBlocked(mode(), c);
      return cell(g, h('div', { class: 'pswatch' + (blocked ? ' blocked' : ''), style: { background: c }, title: blocked ? BLOCKED_TIP : c,
        ondragover: blocked ? null : over,
        ondrop: blocked ? null : (e) => {
          e.preventDefault();
          if (!drag) return;
          apply(drag.t === 'group' ? G.placeOnColor(st.groups, drag.id, c) : G.placeKeyOnColor(st.groups, drag.key, c));
        } }, g ? box(g) : null));
    }));

    return h('section', { class: 'cust-panel wide' }, h('h4', {}, palette.name),
      h('div', { class: 'palette-layout' }, tray, h('div', { class: 'palette-white' }, swatches)));
  }

  // ---------- colour-picker view ----------
  function pickerView(items) {
    if (!items.some((i) => i.key === st.target)) st.target = items[0]?.key;
    const cur = () => items.find((i) => i.key === st.target);
    const nameEls = new Map();
    const picker = createColorPicker({
      onInput: (hex) => {
        if (!cur()) return;
        if (assign([cur().key], hex)) nameEls.get(cur().key).style.color = hex;
        else picker.setColor(cur().get());   // refused: snap back to the item's real colour
      } });
    if (cur()) picker.setColor(cur().get());
    items.forEach((i) => nameEls.set(i.key, h('span', { class: 'pick-name', style: { color: i.get() } }, i.label)));
    const list = h('div', { class: 'pick-list', role: 'radiogroup' });
    items.forEach((i) => {
      const row = h('button', { class: 'pick-row', role: 'radio', 'aria-checked': String(i.key === st.target), title: i.label,
        onclick: () => { st.target = i.key; flash(''); [...list.children].forEach((r) => r.setAttribute('aria-checked', String(r === row))); picker.setColor(i.get()); } },
      h('span', { class: 'radio-dot' }), nameEls.get(i.key));
      list.append(row);
    });
    return h('section', { class: 'cust-panel wide' }, h('h4', {}, 'Color picker'),
      h('div', { class: 'picker-layout' }, list, picker.el));
  }

  // ---------- shell ----------
  function render() {
    clear(root);
    const m = mode();
    const items = getItems(m);
    const modeSel = h('select', { class: 'mode-select', 'aria-label': 'What to customize', title: 'Choose what to colour',
      onchange: (e) => { st.mode = e.target.value; st.target = null; st.groups = null; st.msg = ''; render(); onChange(st.mode); } },
      getModes().map((x) => h('option', { value: x.id, selected: x.id === m }, x.label)));
    footEl = h('div', { class: 'customize-hint' + (st.msg ? ' warn-text' : ''), role: 'status' }, st.msg || DEFAULT_HINT[st.view]);
    root.append(
      h('div', { class: 'customize-head' },
        st.view !== 'home' && h('button', { class: 'link back', onclick: () => go('home'), title: 'Back to palettes' }, '← Back'),
        h('span', { class: 'customize-title' }, title), modeSel),
      st.view === 'home' ? homeView() : st.view === 'palette' ? paletteView(items) : pickerView(items),
      footEl);
  }

  function open() {
    st.view = 'home'; st.groups = null; st.msg = '';
    render();
    root.hidden = false;
    dispose();
    if (dismissOnOutside) dispose = onOutsideClick([root, ...ignoreOutside], close);
  }
  function close() { root.hidden = true; dispose(); }

  return { el: root, open, close, toggle: () => (root.hidden ? open() : close()), isOpen: () => !root.hidden,
    refresh: () => { if (!root.hidden) render(); }, setMode(id) { st.mode = id; st.target = null; st.groups = null; st.msg = ''; } };
}
