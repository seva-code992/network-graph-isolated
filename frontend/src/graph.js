import * as d3 from 'd3';
import { BINS, binOf, idOf, nodeColor as colorOf, nodeVisible } from './logic.js';

const R = 12.5; // nodes are 25px, edges at most 0.5px (Figma)
const MIN_K = 0.125, MAX_K = 8;
const LAYOUT_LINKS_PER_NODE = 8;   // the force layout only uses each gene's strongest edges
const MOVING_EDGE_BUDGET = 15000;  // while moving, large graphs draw a sample of the edges

/**
 * Force-directed network. Genes are SVG circles (interactive, exportable); the edges – tens of
 * thousands when every pair is connected – are painted on a canvas underneath, batched by colour and
 * width, so panning / zooming / dragging stays smooth.
 */
export function createGraph(host, { tooltip, listName, onZoom, onBackgroundClick }) {
  const canvas = d3.select(host).append('canvas').attr('class', 'graph-canvas').node();
  const ctx = canvas.getContext('2d');
  const svg = d3.select(host).append('svg').attr('class', 'graph-svg').attr('role', 'img')
    .attr('aria-label', 'Gene network graph').style('touch-action', 'none');
  const viewport = svg.append('g').attr('class', 'viewport');
  const nodeLayer = viewport.append('g').attr('class', 'nodes');

  let nodes = [], edges = [], sim = null, nodeSel;
  let E = { src: new Int32Array(0), tgt: new Int32Array(0), score: new Float32Array(0), type: new Uint8Array(0) };
  let groups = [], visibleCount = 0;                 // visible edges bucketed by (type, width class)
  let colors = { nodes: {}, edges: {}, shared: null };
  let threshold = 0, hidden = new Set(), highlightId = null, vis = new Uint8Array(0);
  let userMoved = false, width = 800, height = 400, transform = d3.zoomIdentity;
  let moving = false, idleTimer = 0, raf = 0;

  // ---------- painting ----------
  const requestPaint = () => { if (!raf) raf = requestAnimationFrame(paint); };
  function markMoving() {
    moving = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { moving = false; requestPaint(); }, 160); // full-quality repaint once things settle
  }
  function paint() {
    raf = 0;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * transform.k, 0, 0, dpr * transform.k, dpr * transform.x, dpr * transform.y);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.8;
    const stride = moving && visibleCount > MOVING_EDGE_BUDGET ? Math.ceil(visibleCount / MOVING_EDGE_BUDGET) : 1;
    for (const g of groups) {
      ctx.beginPath();
      for (let i = 0; i < g.idx.length; i += stride) {
        const e = g.idx[i], a = nodes[E.src[e]], b = nodes[E.tgt[e]];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = colors.edges[g.type] || '#000';
      ctx.lineWidth = BINS[g.bin].width;
      ctx.stroke();
    }
  }

  /** Which edges are shown (score filter + hidden lists), bucketed for batched painting. */
  function rebuildVisible() {
    vis = Uint8Array.from(nodes, (n) => (nodeVisible(n, hidden) ? 1 : 0));
    const counts = new Int32Array(8), bucketOf = new Uint8Array(E.src.length).fill(255);
    for (let e = 0; e < E.src.length; e++) {
      if (E.score[e] > threshold && vis[E.src[e]] && vis[E.tgt[e]]) {
        const b = (E.type[e] ? 4 : 0) + binOf(E.score[e]);
        bucketOf[e] = b; counts[b]++;
      }
    }
    const lists = Array.from(counts, (c) => new Int32Array(c)), fill = new Int32Array(8);
    for (let e = 0; e < bucketOf.length; e++) if (bucketOf[e] !== 255) lists[bucketOf[e]][fill[bucketOf[e]]++] = e;
    groups = lists.map((idx, b) => ({ idx, type: b >= 4 ? 'expression' : 'annotation', bin: b % 4 })).filter((g) => g.idx.length);
    visibleCount = groups.reduce((a, g) => a + g.idx.length, 0);
    host.dataset.edges = String(visibleCount);
    host.dataset.nodes = String(vis.reduce((a, v) => a + v, 0));
  }

  // ---------- zoom: ctrl+wheel / touchpad pinch (wheel + ctrlKey), drag background to pan ----------
  // A mouse-wheel notch is one gentle fixed step (~x1.15); touchpad pinch sends many small deltas and stays proportional.
  const wheelDelta = (e) => {
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    const mag = Math.abs(dy);
    return -Math.sign(dy) * (mag >= 30 ? 0.2 : Math.min(mag * 0.02, 0.5));
  };
  const zoom = d3.zoom().scaleExtent([MIN_K, MAX_K]).wheelDelta(wheelDelta)
    .filter((e) => (e.type === 'wheel' ? e.ctrlKey : !e.ctrlKey && !e.button && e.type !== 'dblclick'))
    .on('zoom', (e) => {
      transform = e.transform;
      viewport.attr('transform', transform);
      if (e.sourceEvent) userMoved = true;
      markMoving(); requestPaint();
      onZoom?.(transform.k);
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (e) => { if (e.target === svg.node()) onBackgroundClick?.(); });

  const ro = new ResizeObserver(() => {
    width = host.clientWidth || width; height = host.clientHeight || height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    if (sim) sim.force('center', d3.forceCenter(width / 2, height / 2)); // keep layout centred
    if (!userMoved && nodes.length) fit(false);
    requestPaint();
  });
  ro.observe(host);

  // ---------- tooltip ----------
  const showTip = (e, html) => {
    tooltip.replaceChildren(...html);
    tooltip.hidden = false;
    const box = host.getBoundingClientRect();
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tooltip.offsetWidth > box.width) x = e.clientX - box.left - tooltip.offsetWidth - 14;
    if (y + tooltip.offsetHeight > box.height) y = e.clientY - box.top - tooltip.offsetHeight - 14;
    tooltip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  };
  const hideTip = () => { tooltip.hidden = true; };
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const nodeColor = (n) => colorOf(n, colors);

  // ---------- data ----------
  function setData(newNodes, newEdges) {
    sim?.stop();
    nodes = newNodes.map((n) => ({ ...n }));
    edges = newEdges;
    highlightId = null;
    userMoved = false;
    nodeLayer.selectAll('*').remove();
    transform = d3.zoomIdentity;
    viewport.attr('transform', transform);
    svg.call(zoom.transform, d3.zoomIdentity);

    // edges -> typed arrays (indices into `nodes`)
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const m = edges.length;
    E = { src: new Int32Array(m), tgt: new Int32Array(m), score: new Float32Array(m), type: new Uint8Array(m) };
    edges.forEach((e, i) => {
      E.src[i] = index.get(idOf(e.source)); E.tgt[i] = index.get(idOf(e.target));
      E.score[i] = e.score; E.type[i] = e.type === 'expression' ? 1 : 0;
    });

    // the layout only needs each gene's strongest edges (all of them would be tens of thousands of springs)
    const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => E.score[b] - E.score[a]);
    const used = new Int32Array(nodes.length), links = [];
    for (const e of order) {
      const s = E.src[e], t = E.tgt[e];
      if (used[s] < LAYOUT_LINKS_PER_NODE || used[t] < LAYOUT_LINKS_PER_NODE) {
        links.push({ source: s, target: t, score: E.score[e] });
        used[s]++; used[t]++;
      }
    }
    const deg = new Int32Array(nodes.length);
    for (const l of links) { deg[l.source]++; deg[l.target]++; }

    // spread the start so the simulation doesn't begin from a single point
    nodes.forEach((n, i) => {
      const a = i * 2.399963, r = 22 * Math.sqrt(i + 1);
      n.x = width / 2 + r * Math.cos(a); n.y = height / 2 + r * Math.sin(a);
    });
    sim = d3.forceSimulation(nodes)
      // higher scores pull harder and closer, so well-connected genes cluster slightly;
      // strength is divided by the smaller degree so dense graphs do not collapse into a point
      .force('link', d3.forceLink(links).distance((d) => 140 - 70 * d.score)
        .strength((d) => (0.15 + 0.85 * d.score) / Math.min(deg[d.source.index], deg[d.target.index]) ** 0.8))
      .force('charge', d3.forceManyBody().strength(-220).distanceMax(500))
      .force('collide', d3.forceCollide(R + 4))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.06))
      .stop();
    sim.tick(Math.min(300, 60 + nodes.length));   // settle before the first paint
    sim.on('tick', () => { markMoving(); draw(); }).alpha(0.05).restart();

    nodeSel = nodeLayer.selectAll('circle').data(nodes, (d) => d.id).join('circle')
      .attr('r', R).attr('stroke-linejoin', 'round')
      .style('cursor', 'grab')
      .on('mousemove', (ev, d) => showTip(ev, [
        el('div', 'tip-title', d.id),
        el('div', 'tip-sub', `List: ${d.lists.map(listName).join(', ')}`),
        el('div', 'tip-desc', d.description || 'No description'),
        d.fx != null ? el('div', 'tip-hint', 'Pinned — double-click to unpin') : null].filter(Boolean)))
      .on('mouseleave', hideTip)
      .on('dblclick', (ev, d) => { d.fx = d.fy = null; ev.stopPropagation(); style(); sim.alpha(0.2).restart(); })
      .call(d3.drag()
        .on('start', (ev, d) => { hideTip(); markMoving(); if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { markMoving(); d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev) => { if (!ev.active) sim.alphaTarget(0); style(); })); // fx/fy kept -> pinned
    rebuildVisible();
    style();
    draw();
    fit(false);
  }

  function draw() {
    nodeSel.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
    requestPaint();
  }

  /** (Re)apply node colours, visibility and highlight. */
  function style() {
    if (!nodeSel) return;
    nodeSel.attr('fill', nodeColor).attr('display', (d, i) => (vis[i] ? null : 'none'))
      .attr('stroke', (d) => (d.id === highlightId ? '#000' : d.fx != null ? '#424753' : '#BDBDBD'))
      .attr('stroke-width', (d) => (d.id === highlightId ? 4 : d.fx != null ? 2 : 1))
      .classed('highlight', (d) => d.id === highlightId);
    nodeSel.filter((d) => d.id === highlightId).raise();
  }

  // ---------- view ----------
  function fit(animate = true) {
    const shown = nodes.filter((n, i) => vis[i]);
    if (!shown.length) return;
    const [x0, x1] = d3.extent(shown, (n) => n.x), [y0, y1] = d3.extent(shown, (n) => n.y);
    const pad = 50, w = x1 - x0 + 2 * R, h = y1 - y0 + 2 * R;
    const k = Math.min(1.5, Math.max(MIN_K, Math.min((width - pad * 2) / w, (height - pad * 2) / h)));
    const t = d3.zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, height / 2 - (k * (y0 + y1)) / 2).scale(k);
    (animate ? svg.transition().duration(450) : svg).call(zoom.transform, t);
  }

  function highlight(id, { pan = true } = {}) {
    highlightId = id;
    style();
    const n = nodes.find((x) => x.id === id);
    if (!n || !pan) return;
    const t = d3.zoomTransform(svg.node());
    const [sx, sy] = t.apply([n.x, n.y]), m = 40;
    if (sx < m || sy < m || sx > width - m || sy > height - m) { // outside the visible frame -> bring it in
      const next = d3.zoomIdentity.translate(width / 2 - t.k * n.x, height / 2 - t.k * n.y).scale(t.k);
      svg.transition().duration(600).call(zoom.transform, next);
    }
  }

  /** The visible graph as a standalone SVG document (edges are canvas-painted, so they are rebuilt here). */
  function toSvgString() {
    const f = (v) => v.toFixed(1);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      `<g transform="translate(${transform.x} ${transform.y}) scale(${transform.k})">`];
    for (const g of groups) {
      let d = '';
      for (let i = 0; i < g.idx.length; i++) {
        const a = nodes[E.src[g.idx[i]]], b = nodes[E.tgt[g.idx[i]]];
        d += `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
      }
      parts.push(`<path d="${d}" fill="none" stroke="${colors.edges[g.type] || '#000'}" stroke-width="${BINS[g.bin].width}" stroke-opacity="0.8" stroke-linecap="round"/>`);
    }
    const layer = nodeLayer.node().cloneNode(true);
    layer.querySelectorAll('[display="none"]').forEach((n) => n.remove());
    parts.push(new XMLSerializer().serializeToString(layer), '</g></svg>');
    return parts.join('');
  }

  return {
    setData,
    setColors(c) { colors = c; style(); requestPaint(); },
    setThreshold(v) { threshold = v; rebuildVisible(); requestPaint(); },
    setHidden(set) { hidden = set; rebuildVisible(); style(); requestPaint(); },
    highlight,
    clearHighlight() { highlightId = null; style(); },
    zoomTo(k) { svg.transition().duration(150).call(zoom.scaleTo, Math.min(MAX_K, Math.max(MIN_K, k))); },
    zoomBy(f) { svg.transition().duration(200).call(zoom.scaleBy, f); },
    reset() { userMoved = false; fit(true); },
    toSvgString,
    size: () => ({ width, height }),
    destroy() { sim?.stop(); ro.disconnect(); clearTimeout(idleTimer); cancelAnimationFrame(raf); svg.remove(); canvas.remove(); },
  };
}
export const ZOOM_RANGE = [MIN_K, MAX_K];
