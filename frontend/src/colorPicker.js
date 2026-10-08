import { h, svgIcon } from './dom.js';

// ---------- colour maths ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export function hsvToRgb({ h: hh, s, v }) {
  const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}
export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (hh * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export function rgbToHsl([r, g, b]) {
  const { h: hh, s, v } = rgbToHsv([r, g, b]);
  const l = v * (1 - s / 2);
  return [Math.round(hh), Math.round((l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)) * 100), Math.round(l * 100)];
}
export function hslToRgb([hh, s, l]) {
  s /= 100; l /= 100;
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h: hh, s: v ? 2 * (1 - l / v) : 0, v });
}
const h2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
/** -> '#rrggbb', or '#rrggbbaa' when not fully opaque */
export const toHex = (rgb, a = 1) => '#' + rgb.map(h2).join('') + (a < 1 ? h2(a * 255) : '');
/** '#abc' | 'abcdef' | '#aabbccdd' -> {rgb, a} or null */
export function parseHex(text) {
  let t = String(text).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(t)) t = [...t].map((c) => c + c).join('');
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return null;
  return { rgb: [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16)), a: t.length === 8 ? parseInt(t.slice(6), 16) / 255 : 1 };
}

const EYE = 'M9.5 1.8a1.6 1.6 0 0 1 2.3 2.3l-1.2 1.2.5.5-1 1-.5-.5-4.9 4.9-2.2.6.6-2.2 4.9-4.9-.5-.5 1-1 .5.5z';

/**
 * Realistic colour picker: saturation/value square, hue + opacity sliders, eye-dropper and a
 * Hex / RGB / HSL read-out. onInput(hex) fires on every change; setColor(hex) updates it silently.
 */
export function createColorPicker({ onInput }) {
  let c = { h: 200, s: 1, v: 1, a: 1 };
  let fmt = 'hex';
  const el = h('div', { class: 'cp' });
  const handle = () => h('span', { class: 'cp-handle' });
  const svHandle = handle(), hueHandle = handle(), alphaHandle = handle();
  const sv = h('div', { class: 'cp-sv', role: 'slider', 'aria-label': 'Saturation and brightness', tabindex: '0' }, svHandle);
  const hue = h('div', { class: 'cp-hue', role: 'slider', 'aria-label': 'Hue', tabindex: '0' }, hueHandle);
  const alphaFill = h('div', { class: 'cp-alpha-fill' });
  const alpha = h('div', { class: 'cp-alpha', role: 'slider', 'aria-label': 'Opacity', tabindex: '0' }, alphaFill, alphaHandle);
  const readout = h('div', { class: 'cp-read' });
  const eye = h('button', { class: 'cp-eye', 'aria-label': 'Pick a colour from the screen', disabled: !('EyeDropper' in window),
    title: 'EyeDropper' in window ? 'Pick a colour from anywhere on the screen' : 'Eye dropper is not supported by this browser',
    onclick: async () => { try { setColor((await new window.EyeDropper().open()).sRGBHex); emit(); } catch { /* cancelled */ } } },
  svgIcon(EYE, { size: 13, stroke: '#424753', width: 1.2 }));

  const rgb = () => hsvToRgb(c);
  const hex = () => toHex(rgb(), c.a);
  const emit = () => onInput(hex());

  function drag(target, fn) {
    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId);
      const move = (ev) => { const r = target.getBoundingClientRect(); fn(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height)); paint(); emit(); };
      move(e);
      target.onpointermove = move;
      target.onpointerup = () => { target.onpointermove = null; };
    });
  }
  drag(sv, (x, y) => { c.s = x; c.v = 1 - y; });
  drag(hue, (x, y) => { c.h = y * 360; });
  drag(alpha, (x, y) => { c.a = Math.round((1 - y) * 100) / 100; });
  const key = (target, fn) => target.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) { e.preventDefault(); fn(d[0] * 0.02, d[1] * 0.02); paint(); emit(); }
  });
  key(sv, (dx, dy) => { c.s = clamp(c.s + dx); c.v = clamp(c.v - dy); });
  key(hue, (dx, dy) => { c.h = clamp(c.h / 360 + dy) * 360; });
  key(alpha, (dx, dy) => { c.a = clamp(c.a - dy); });

  function field(value, onCommit, { width = 40, label }) {
    const i = h('input', { class: 'cp-in', value, size: '1', 'aria-label': label, style: { width: `${width}px` },
      onchange: () => { if (!onCommit(i.value)) i.classList.add('bad'); else i.classList.remove('bad'); } });
    return i;
  }
  function paintReadout() {
    const [r, g, b] = rgb();
    const fmtSel = h('select', { class: 'cp-fmt', 'aria-label': 'Colour format', onchange: (e) => { fmt = e.target.value; paintReadout(); } },
      ['hex', 'rgb', 'hsl'].map((f) => h('option', { value: f, selected: f === fmt }, f === 'hex' ? 'Hex' : f.toUpperCase())));
    const set = (rgbv) => { const hv = rgbToHsv(rgbv); if (hv.s > 0 && hv.v > 0) c.h = hv.h; c.s = hv.s; c.v = hv.v; paint(); emit(); return true; };
    const nums = (vals, max, toRgb) => vals.map((v, k) => field(String(v), (t) => {
      const n = Number(t); if (!Number.isFinite(n)) return false;
      const next = [...vals]; next[k] = clamp(Math.round(n), 0, max[k]); set(toRgb(next)); return true;
    }, { width: 26, label: ['1st', '2nd', '3rd'][k] + ' value' }));
    const values = fmt === 'hex'
      ? [field(hex().slice(1, 7).toUpperCase(), (t) => { const p = parseHex(t); if (!p) return false; set(p.rgb); return true; }, { width: 54, label: 'Hex value' })]
      : fmt === 'rgb' ? nums([r, g, b], [255, 255, 255], (v) => v) : nums(rgbToHsl([r, g, b]), [360, 100, 100], hslToRgb);
    const pct = field(String(Math.round(c.a * 100)), (t) => { const n = Number(t); if (!Number.isFinite(n)) return false; c.a = clamp(n / 100); paint(); emit(); return true; }, { width: 26, label: 'Opacity percent' });
    readout.replaceChildren(fmtSel, ...values, pct, h('span', { class: 'cp-pct' }, '%'));
  }

  function paint() {
    const [r, g, b] = rgb();
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${c.h} 100% 50%))`;
    svHandle.style.left = `${c.s * 100}%`; svHandle.style.top = `${(1 - c.v) * 100}%`;
    hueHandle.style.top = `${(c.h / 360) * 100}%`; hueHandle.style.background = `hsl(${c.h} 100% 50%)`;
    alphaHandle.style.top = `${(1 - c.a) * 100}%`; alphaHandle.style.background = `rgb(${r} ${g} ${b})`;
    svHandle.style.background = `rgb(${r} ${g} ${b})`;
    alphaFill.style.background = `linear-gradient(to bottom, rgb(${r} ${g} ${b}), rgb(${r} ${g} ${b} / 0))`;
    paintReadout();
  }

  function setColor(value) {
    const p = parseHex(value);
    if (!p) return;
    const hv = rgbToHsv(p.rgb);
    c = { h: hv.s > 0 && hv.v > 0 ? hv.h : c.h, s: hv.s, v: hv.v, a: p.a };
    paint();
  }

  el.append(h('div', { class: 'cp-main' }, sv, hue, alpha), h('div', { class: 'cp-tools' }, eye), readout);
  paint();
  return { el, setColor };
}
