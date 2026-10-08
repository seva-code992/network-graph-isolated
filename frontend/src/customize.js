import { h, clear, onOutsideClick } from './dom.js';
import { PALETTES } from './palettes.js';
import { gradientColor } from './logic.js';

const HUE_STOPS = [
  { at: 0, color: '#FF8000' }, { at: 0.2212, color: '#F7FF01' }, { at: 0.399, color: '#02F986' },
  { at: 0.5865, color: '#00EEFF' }, { at: 0.8317, color: '#9100FF' }, { at: 1, color: '#FF0004' },
];
const GRADIENT = 'linear-gradient(180deg, ' + HUE_STOPS.map((s) => `${s.color} ${(s.at * 100).toFixed(1)}%`).join(', ') + ')';
const BLOCKED_TIP = 'This colour is already used by another group of nodes — choose a different one';

/**
 * Colour box (palettes + colour picker). Changes are applied immediately.
 *
 * getModes()         -> [{id, label}]            entries of the drop-down (e.g. nodes / edges)
 * getItems(modeId)   -> [{key, label, get(), set(hex)}]   the things that can be coloured
 * isBlocked(modeId, hex) -> true when that colour must not be used (greyed out / refused)
 * onChange(modeId)   called after every applied colour
 * dismissOnOutside   hide on a click outside (graph page) – false when embedded in a dialog
 */
export function createCustomize({ getModes, getItems, isBlocked = () => false, onChange, ignoreOutside = [],
  dismissOnOutside = true, title = 'Customize your graph' }) {
  const st = { mode: null, target: null, msg: '' };
  const root = h('div', { class: 'customize', hidden: true, role: 'dialog', 'aria-label': title });
  let dispose = () => {};

  const mode = () => {
    const modes = getModes();
    if (!modes.some((m) => m.id === st.mode)) st.mode = modes[0].id;
    return st.mode;
  };
  const current = () => { const its = getItems(mode()); return its.find((i) => i.key === st.target) ?? its[0]; };
  function apply(hex) {
    if (!current()) return;
    if (isBlocked(mode(), hex)) { st.msg = BLOCKED_TIP + '.'; render(); return; }
    st.msg = '';
    current().set(hex);
    onChange(mode());
    render();
  }

  function render() {
    clear(root);
    const m = mode();
    const its = getItems(m);
    st.target = current()?.key;

    const modeSel = h('select', { class: 'mode-select', 'aria-label': 'What to customize', title: 'Choose what to colour',
      onchange: (e) => { st.mode = e.target.value; st.target = null; st.msg = ''; render(); onChange(st.mode); } },
      getModes().map((x) => h('option', { value: x.id, selected: x.id === m }, x.label)));

    const chips = its.map((i) => h('div', {
      class: 'chip' + (i.key === st.target ? ' selected' : ''), draggable: true, role: 'button', tabindex: '0',
      title: 'Drag onto a colour, or select it and then pick a colour',
      onclick: () => { st.target = i.key; st.msg = ''; render(); },
      ondragstart: (e) => { st.target = i.key; e.dataTransfer.setData('text/plain', i.key); e.dataTransfer.effectAllowed = 'copy'; },
    }, h('span', { class: 'dot', style: { background: i.get() } }), h('span', { class: 'chip-label', title: i.label }, i.label)));

    const palettes = PALETTES.map((p) => h('div', { class: 'palette' },
      h('div', { class: 'palette-name' }, p.name),
      h('div', { class: 'swatches' }, p.colors.map((c) => {
        const blocked = isBlocked(m, c);
        return h('button', {
          class: 'swatch' + (blocked ? ' blocked' : ''), style: { background: c }, disabled: blocked,
          title: blocked ? BLOCKED_TIP : `${c} – drop a name here or click to apply to “${current()?.label}”`,
          'aria-label': blocked ? `Colour ${c} (unavailable)` : `Colour ${c}`,
          ondragover: blocked ? null : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
          ondrop: blocked ? null : (e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k) st.target = k; apply(c); },
          onclick: () => apply(c),
        });
      }))));

    const bar = h('div', { class: 'hue-bar', style: { background: GRADIENT }, title: 'Click or drag to pick a colour from the rainbow',
      onpointerdown: (e) => {
        const pick = (ev) => { const r = bar.getBoundingClientRect(); apply(gradientColor(HUE_STOPS, (ev.clientY - r.top) / r.height)); };
        bar.setPointerCapture(e.pointerId);
        pick(e);
        bar.onpointermove = pick;
        bar.onpointerup = () => { bar.onpointermove = null; };
      } });
    const picker = h('input', { type: 'color', class: 'native-color', value: current()?.get() ?? '#000000',
      title: 'Open the colour picker to choose any exact colour', 'aria-label': 'Custom colour', oninput: (e) => apply(e.target.value) });

    root.append(
      h('div', { class: 'customize-head' }, h('span', { class: 'customize-title' }, title), modeSel),
      h('div', { class: 'customize-body' },
        h('section', { class: 'cust-panel palettes-panel' }, h('h4', {}, 'Available palettes'),
          h('div', { class: 'palettes' }, palettes)),
        h('section', { class: 'cust-panel picker-panel' }, h('h4', {}, 'Color picker'),
          h('div', { class: 'chips' }, chips),
          h('div', { class: 'picker-row' }, bar, picker))),
      st.msg ? h('div', { class: 'customize-hint warn-text', role: 'status' }, st.msg)
        : h('div', { class: 'customize-hint' }, 'Drag a name onto a colour — or select it and click a colour or use the colour picker.'));
  }

  function open() {
    render();
    root.hidden = false;
    dispose();
    if (dismissOnOutside) dispose = onOutsideClick([root, ...ignoreOutside], close);
  }
  function close() { root.hidden = true; dispose(); }

  return { el: root, open, close, toggle: () => (root.hidden ? open() : close()), isOpen: () => !root.hidden,
    refresh: () => { if (!root.hidden) render(); }, setMode(id) { st.mode = id; st.target = null; st.msg = ''; } };
}
