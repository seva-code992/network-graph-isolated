// Tiny DOM helper. Text always goes in as text nodes (never innerHTML), so gene descriptions,
// list names etc. coming from the API / user files cannot inject markup.
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'draggable', 'hidden']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svgIcon(pathD, { size = 14, stroke = '#0FA120', width = 2 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', pathD);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', stroke);
  p.setAttribute('stroke-width', width);
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

/** A horizontal line sample for legends. SVG, not a CSS border: borders snap to whole device
 *  pixels, which makes 0.1px and 0.5px lines look identical; SVG strokes keep fractional widths
 *  (and are anti-aliased, like the edges drawn in the graph). */
export function lineSample(color, width, length = 27) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', length);
  svg.setAttribute('height', 4);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sample');
  const l = document.createElementNS(SVG_NS, 'line');
  for (const [k, v] of Object.entries({ x1: 0, x2: length, y1: 2, y2: 2, stroke: color, 'stroke-width': width })) l.setAttribute(k, v);
  svg.append(l);
  return svg;
}

/** Keep a moved box reachable: at least `keep` px of it stay inside the window. rect = the box without any offset. */
export function clampOffset(x, y, rect, win, keep = 48) {
  const cx = Math.min(Math.max(x, keep - (rect.left + rect.width)), win.width - keep - rect.left);
  const cy = Math.min(Math.max(y, -rect.top), win.height - keep - rect.top);
  return [cx, cy];
}

const NO_DRAG = 'input,textarea,select,button,a,label,[draggable="true"],[role="checkbox"],[contenteditable]';

/**
 * Let a pop-up be moved by dragging it. `container` is an element that stays in the page (it receives the
 * pointer events); `getBox()` returns the box to move right now (it may be re-created on every render, call
 * `apply()` after rendering to put it back where the user left it). Dragging starts on any spot that is not a
 * control (`skip` adds more selectors to leave alone); with `handle`, only on elements matching it.
 */
export function makeDraggable(container, getBox, { skip = '', handle = null } = {}) {
  let x = 0, y = 0, drag = null;
  const apply = () => { const b = getBox(); if (b) b.style.translate = x || y ? `${x}px ${y}px` : ''; };
  container.addEventListener('pointerdown', (e) => {
    const box = getBox();
    if (!box || e.button !== 0 || !box.contains(e.target) || e.target.closest([NO_DRAG, skip].filter(Boolean).join(','))) return;
    if (handle && !(e.target === box || e.target.closest(handle))) return;
    const r = box.getBoundingClientRect();
    drag = { px: e.clientX - x, py: e.clientY - y, rect: { left: r.left - x, top: r.top - y, width: r.width, height: r.height } };
    document.body.style.userSelect = 'none';
    e.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    window.addEventListener('pointercancel', end, { once: true });
  });
  function move(e) {
    if (!drag) return;
    [x, y] = clampOffset(e.clientX - drag.px, e.clientY - drag.py, drag.rect, { width: innerWidth, height: innerHeight });
    apply();
  }
  function end() {
    drag = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', move);
  }
  return { apply, reset() { x = y = 0; apply(); }, destroy: end };
}

/** Run `fn` on the next pointerdown outside `els`; returns a disposer. */
export function onOutsideClick(els, fn) {
  const list = [els].flat();
  const handler = (e) => {
    if (!list.some((el) => el && el.contains(e.target))) fn(e);
  };
  document.addEventListener('pointerdown', handler, true);
  return () => document.removeEventListener('pointerdown', handler, true);
}
