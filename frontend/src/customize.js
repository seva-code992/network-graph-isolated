import { h, clear, onOutsideClick } from './dom.js';
import { PALETTES } from './palettes.js';
import { gradientColor } from './logic.js';

const HUE_STOPS = [
  { at: 0, color: '#FF8000' }, { at: 0.2212, color: '#F7FF01' }, { at: 0.399, color: '#02F986' },
  { at: 0.5865, color: '#00EEFF' }, { at: 0.8317, color: '#9100FF' }, { at: 1, color: '#FF0004' },
];
const GRADIENT = 'linear-gradient(180deg, ' + HUE_STOPS.map((s) => `${s.color} ${(s.at * 100).toFixed(1)}%`).join(', ') + ')';

/**
 * Colour customisation box. Changes are applied immediately through onChange(colors).
 * getColors() -> { nodes: {listId: hex}, edges: {annotation: hex, expression: hex} } (mutated in place).
 */
export function createCustomize({ getLists, getColors, onChange, ignoreOutside = [] }) {
  const st = { mode: 'nodes', target: null, dragging: null };
  const root = h('div', { class: 'customize', hidden: true, role: 'dialog', 'aria-label': 'Customize your graph' });
  let dispose = () => {};

  const items = () => (st.mode === 'nodes'
    ? getLists().map((l) => ({ key: l.id, label: l.name, get: () => getColors().nodes[l.id], set: (c) => { getColors().nodes[l.id] = c; } }))
    : [{ key: 'annotation', label: 'annotations', get: () => getColors().edges.annotation, set: (c) => { getColors().edges.annotation = c; } },
       { key: 'expression', label: 'expression', get: () => getColors().edges.expression, set: (c) => { getColors().edges.expression = c; } }]);
  const current = () => items().find((i) => i.key === st.target) ?? items()[0];
  const apply = (hex) => { current().set(hex); onChange(getColors()); render(); };

  function render() {
    clear(root);
    const its = items();
    st.target = current()?.key;

    const modeSel = h('select', { class: 'mode-select', 'aria-label': 'Customize nodes or edges', title: 'Choose what to colour',
      onchange: (e) => { st.mode = e.target.value; st.target = null; render(); } },
      h('option', { value: 'nodes', selected: st.mode === 'nodes' }, 'nodes'),
      h('option', { value: 'edges', selected: st.mode === 'edges' }, 'edges'));

    const chips = its.map((i) => h('div', {
      class: 'chip' + (i.key === st.target ? ' selected' : ''), draggable: true, role: 'button', tabindex: '0',
      title: 'Drag onto a colour, or select it and then pick a colour',
      onclick: () => { st.target = i.key; render(); },
      ondragstart: (e) => { st.target = i.key; e.dataTransfer.setData('text/plain', i.key); e.dataTransfer.effectAllowed = 'copy'; },
    }, h('span', { class: 'dot', style: { background: i.get() } }), h('span', { class: 'chip-label' }, i.label)));

    const palettes = PALETTES.map((p) => h('div', { class: 'palette' },
      h('div', { class: 'palette-name' }, p.name),
      h('div', { class: 'swatches' }, p.colors.map((c) => h('button', {
        class: 'swatch', style: { background: c }, title: `${c} – drop a name here or click to apply to “${current()?.label}”`,
        'aria-label': `Colour ${c}`,
        ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
        ondrop: (e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k) st.target = k; apply(c); },
        onclick: () => apply(c),
      })))));

    const bar = h('div', { class: 'hue-bar', style: { background: GRADIENT }, title: 'Click or drag to pick a colour',
      onpointerdown: (e) => {
        const pick = (ev) => { const r = bar.getBoundingClientRect(); apply(gradientColor(HUE_STOPS, (ev.clientY - r.top) / r.height)); };
        bar.setPointerCapture(e.pointerId);
        pick(e);
        bar.onpointermove = pick;
        bar.onpointerup = () => { bar.onpointermove = null; };
      } });
    const picker = h('input', { type: 'color', class: 'native-color', value: current()?.get() ?? '#000000',
      title: 'Open the colour picker', 'aria-label': 'Custom colour', oninput: (e) => apply(e.target.value) });

    root.append(
      h('div', { class: 'customize-head' }, h('span', { class: 'customize-title' }, 'Customize your graph'), modeSel),
      h('div', { class: 'customize-body' },
        h('section', { class: 'cust-panel palettes-panel' }, h('h4', {}, 'Available palettes'),
          h('div', { class: 'palettes' }, palettes)),
        h('section', { class: 'cust-panel picker-panel' }, h('h4', {}, 'Color picker'),
          h('div', { class: 'chips', title: '' }, chips),
          h('div', { class: 'picker-row' }, bar, picker))),
      h('div', { class: 'customize-hint' }, 'Drag a name onto a colour — or select it and click a colour or use the colour picker.'));
  }

  function open() {
    render();
    root.hidden = false;
    dispose();
    dispose = onOutsideClick([root, ...ignoreOutside], close);
  }
  function close() { root.hidden = true; dispose(); }

  return { el: root, open, close, toggle: () => (root.hidden ? open() : close()), isOpen: () => !root.hidden,
    refresh: () => { if (!root.hidden) render(); } };
}
