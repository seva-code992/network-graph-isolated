import * as d3 from 'd3';
import { BINS, binOf, idOf, nodeColor as colorOf, nodeVisible } from './logic.js';
import { louvain, groupUnlinked } from './cluster.js';
import { createWheelClassifier, wheelZoomDelta, wheelPanDelta } from './gestures.js';
import { FOCUS_SCALE, pushAside, pullAround, relax } from './focus.js';

const R = 12.5; // nodes are 25px, edges at most 0.5px (Figma)
const MIN_K = 0.125, MAX_K = 8;
const LAYOUT_LINKS_PER_NODE = 8;   // grouping and layout only use each gene's strongest edges
const GROUP_RESOLUTION = 1.2;      // >1 -> more, smaller groups
const MOVING_EDGE_BUDGET = 15000;  // while moving, large graphs draw a sample of the edges
const FOCUS_MS = 350;              // the located gene grows / its neighbours move aside over this long
const GLOW = '#FFD54A';

/**
 * Clustered network: genes are grouped by their strongest edges, groups are placed apart from each other and the
 * genes inside a group are laid out by a force simulation that is run once, to rest – nothing moves afterwards
 * except the gene the user drags. Genes are SVG circles (interactive, exportable); the edges – tens of
 * thousands when every pair is connected – are painted on a canvas underneath, batched by colour and
 * width, so panning / zooming / dragging stays smooth.
 */
export function createGraph(host, { tooltip, listName, onZoom, onSelect }) {
  const canvas = d3.select(host).append('canvas').attr('class', 'graph-canvas').node();
  const ctx = canvas.getContext('2d');
  const svg = d3.select(host).append('svg').attr('class', 'graph-svg').attr('role', 'img')
    .attr('aria-label', 'Gene network graph').style('touch-action', 'none');
  // soft yellow glow behind the located gene
  svg.append('defs').html(`<filter id="ng-glow" x="-150%" y="-150%" width="400%" height="400%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/><feFlood flood-color="${GLOW}" flood-opacity="0.95"/>
    <feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  const viewport = svg.append('g').attr('class', 'viewport');
  const nodeLayer = viewport.append('g').attr('class', 'nodes');

  let nodes = [], edges = [], nodeSel;
  let E = { src: new Int32Array(0), tgt: new Int32Array(0), score: new Float32Array(0), type: new Uint8Array(0) };
  let groups = [], visibleCount = 0;                 // visible edges bucketed by (type, width class)
  let colors = { nodes: {}, edges: {}, shared: null };
  let threshold = 0, hidden = new Set(), hiddenTypes = new Set(), highlightId = null, linked = new Set(), vis = new Uint8Array(0);
  const pushed = new Map();   // gene -> its position before the located gene pushed it aside
  let tweenTimer = null;
  const sel = new Set();   // selected genes (click; ctrl+click adds / removes)
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
      if (E.score[e] > threshold && vis[E.src[e]] && vis[E.tgt[e]] && !hiddenTypes.has(E.type[e] ? 'expression' : 'annotation')) {
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

  // ---------- zoom / pan ----------
  // scroll wheel, ctrl + wheel and touchpad pinch zoom; a two-finger swipe on a touchpad pans; drag the background to pan
  const classify = createWheelClassifier();
  const zoom = d3.zoom().scaleExtent([MIN_K, MAX_K]).wheelDelta(wheelZoomDelta)
    .filter((e) => (e.type === 'wheel' ? classify(e) === 'zoom' : !e.ctrlKey && !e.button && e.type !== 'dblclick'))
    .on('zoom', (e) => {
      transform = e.transform;
      viewport.attr('transform', transform);
      if (e.sourceEvent) userMoved = true;
      markMoving(); requestPaint();
      onZoom?.(transform.k);
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click.deselect', (e) => { if (e.target.tagName !== 'circle') select(null); });   // click on the background
  svg.on('wheel.pan', (e) => {
    if (classify(e) !== 'pan') return;
    e.preventDefault();
    const [dx, dy] = wheelPanDelta(e), k = d3.zoomTransform(svg.node()).k;
    userMoved = true;
    zoom.translateBy(svg, -dx / k, -dy / k);
  }, { passive: false });

  const ro = new ResizeObserver(() => {
    width = host.clientWidth || width; height = host.clientHeight || height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
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
  function setData(newNodes, newEdges, clusterBy = null) {
    stopFocus();
    nodes = newNodes.map((n) => ({ ...n, r: R }));
    edges = newEdges;
    userMoved = false;
    nodeLayer.selectAll('*').remove();
    transform = d3.zoomIdentity;
    viewport.attr('transform', transform);
    svg.call(zoom.transform, d3.zoomIdentity);
    buildEdges();
    layout(strongLinks(clusterBy));
    bindNodes();
    rebuildVisible();
    style();
    draw();
    fit(false);
  }

  /** edges -> typed arrays (indices into `nodes`) */
  function buildEdges() {
    nodes.forEach((n, i) => { n.index = i; });
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const m = edges.length;
    E = { src: new Int32Array(m), tgt: new Int32Array(m), score: new Float32Array(m), type: new Uint8Array(m) };
    edges.forEach((e, i) => {
      E.src[i] = index.get(idOf(e.source)); E.tgt[i] = index.get(idOf(e.target));
      E.score[i] = e.score; E.type[i] = e.type === 'expression' ? 1 : 0;
    });
  }

  function bindNodes() {
    nodeSel = nodeLayer.selectAll('circle').data(nodes, (d) => d.id).join('circle')
      .attr('r', R).attr('stroke-linejoin', 'round')
      .on('pointerdown.focus', (ev, d) => pushed.delete(d))   // a gene the user moves keeps its new place
      .style('cursor', 'grab')
      .on('mousemove', (ev, d) => showTip(ev, [
        el('div', 'tip-title', d.id),
        el('div', 'tip-sub', `List: ${d.lists.map(listName).join(', ')}`),
        el('div', 'tip-desc', d.description || 'No description')]))
      .on('mouseleave', hideTip)
      .on('click', (ev, d) => { ev.stopPropagation(); select(d.id, { additive: ev.ctrlKey || ev.metaKey }); })
      .call(d3.drag()   // genes can be dragged; they stay where they are dropped
        .on('start', () => { hideTip(); markMoving(); })
        .on('drag', (ev, d) => { markMoving(); d.x = ev.x; d.y = ev.y; draw(); }));
  }

  /** Remove genes (and their edges) from the graph; everything else stays where it is. */
  function removeNodes(ids) {
    const gone = new Set(ids);
    stopFocus();
    hideTip();
    nodes = nodes.filter((n) => !gone.has(n.id));
    edges = edges.filter((e) => !gone.has(idOf(e.source)) && !gone.has(idOf(e.target)));
    buildEdges();
    bindNodes();
    rebuildVisible();
    style();
    draw();
    onSelect?.([]);
  }

  /** The layout only needs each gene's strongest edges (all of them would be tens of thousands of springs).
   *  type: 'expression' | 'annotation' -> only edges of that type; null -> all edges. */
  function strongLinks(type) {
    const code = type === 'expression' ? 1 : type === 'annotation' ? 0 : -1;
    const order = [];
    for (let e = 0; e < E.src.length; e++) if (code < 0 || E.type[e] === code) order.push(e);
    order.sort((a, b) => E.score[b] - E.score[a]);
    const used = new Int32Array(nodes.length), links = [];
    for (const e of order) {
      const s = E.src[e], t = E.tgt[e];
      if (used[s] < LAYOUT_LINKS_PER_NODE || used[t] < LAYOUT_LINKS_PER_NODE) {
        links.push({ source: s, target: t, score: E.score[e] });
        used[s]++; used[t]++;
      }
    }
    return links;
  }

  /** Group genes by their strongest links, pack the groups apart, then settle each group with a force simulation. */
  function layout(links) {
    const n = nodes.length;
    const comm = groupUnlinked(   // genes without any of these edges share one group
      louvain(n, links.map((l) => ({ source: l.source, target: l.target, weight: l.score })), GROUP_RESOLUTION), links);
    const deg = new Int32Array(n);
    for (const l of links) { deg[l.source]++; deg[l.target]++; }
    const members = [];
    comm.forEach((c, i) => (members[c] ??= []).push(i));
    // one circle per group, sized by its number of genes, packed with room around each
    const circles = members.map((m, c) => ({ c, r: Math.sqrt(m.length) * R * 2.4 + 34 }));
    d3.packSiblings(circles);
    const centre = circles.map((o) => ({ x: width / 2 + o.x, y: height / 2 + o.y }));
    members.forEach((m, c) => m.forEach((i, k) => {
      const a = k * 2.399963, r = R * 1.8 * Math.sqrt(k);
      nodes[i].x = centre[c].x + r * Math.cos(a); nodes[i].y = centre[c].y + r * Math.sin(a);
    }));
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .distance((d) => (comm[d.source.index] === comm[d.target.index] ? 40 + 60 * (1 - d.score) : 220))
        .strength((d) => (comm[d.source.index] === comm[d.target.index]
          ? (0.2 + 0.8 * d.score) / Math.min(deg[d.source.index], deg[d.target.index]) ** 0.5 : 0.005)))
      .force('charge', d3.forceManyBody().strength(-45).distanceMax(150))
      .force('collide', d3.forceCollide(R + 3))
      .force('x', d3.forceX((d) => centre[comm[d.index]].x).strength(0.22))
      .force('y', d3.forceY((d) => centre[comm[d.index]].y).strength(0.22))
      .stop();
    sim.tick(300);   // ~ until the simulation has cooled completely; it is never restarted
  }

  function draw() {
    nodeSel.attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', (d) => d.r);
    requestPaint();
  }

  /** Re-group and re-place the genes by one kind of edge only ('expression' | 'annotation'), or by all (null). */
  function recluster(type) {
    if (!nodes.length) return;
    stopFocus();
    style();
    const prev = new Map(nodes.map((n) => [n, { x: n.x, y: n.y, r: n.r }]));
    layout(strongLinks(type));
    userMoved = false;
    fit(true);                 // reads the new positions
    tweenFrom(prev, 600);      // ...and the genes glide there from the old ones
  }
  const hasEdgesOf = (type) => E.type.some((t) => t === (type === 'expression' ? 1 : 0));

  // ---------- animation of genes (growing / moving aside / re-clustering) ----------
  /** The genes now hold their end state; start them at `prev` (Map gene -> {x, y, r}) and glide to it. */
  function tweenFrom(prev, ms = FOCUS_MS) {
    tweenTimer?.stop();
    const end = new Map([...prev.keys()].map((n) => [n, { x: n.x, y: n.y, r: n.r }]));
    const step = (t) => {
      for (const [n, s] of prev) { const e = end.get(n); n.x = s.x + (e.x - s.x) * t; n.y = s.y + (e.y - s.y) * t; n.r = s.r + (e.r - s.r) * t; }
      draw();
    };
    step(0);
    tweenTimer = d3.timer((elapsed) => {
      const f = Math.min(1, elapsed / ms);
      step(d3.easeCubicInOut(f));
      if (f >= 1) { tweenTimer.stop(); tweenTimer = null; }
    });
  }
  /** Back to the resting state: nothing located, every gene in place and of normal size. */
  function stopFocus() {
    tweenTimer?.stop(); tweenTimer = null;
    for (const [n, o] of pushed) { n.x = o.x; n.y = o.y; }
    pushed.clear();
    for (const n of nodes) n.r = R;
    highlightId = null; sel.clear(); linked = new Set();
  }
  /** The genes joined to `id` by a visible edge, strongest edge first. */
  function neighboursOf(id) {
    const i = nodes.findIndex((n) => n.id === id), best = new Map();
    for (const g of groups) for (const e of g.idx) {
      const other = E.src[e] === i ? E.tgt[e] : E.tgt[e] === i ? E.src[e] : -1;
      if (other >= 0 && E.score[e] > (best.get(other) ?? -1)) best.set(other, E.score[e]);
    }
    return [...best].sort((p, q) => q[1] - p[1]).map(([j]) => nodes[j]);
  }
  /** Arrange the genes around gene `id` (null: none): kind 'grow' = it gets bigger and its neighbours make room;
   *  kind 'pull' = the genes connected to it by visible edges are pulled around it. Everything else returns to rest. */
  function setFocus(kind, id) {
    const prev = new Map();
    const touch = (n) => { if (!prev.has(n)) prev.set(n, { x: n.x, y: n.y, r: n.r }); };
    tweenTimer?.stop();
    for (const [n, o] of pushed) { touch(n); n.x = o.x; n.y = o.y; }
    pushed.clear();
    for (const n of nodes) if (n.r !== R) { touch(n); n.r = R; }
    const c = id && nodes.find((n) => n.id === id && vis[n.index]);
    const move = (n, p) => { touch(n); if (!pushed.has(n)) pushed.set(n, { x: n.x, y: n.y }); n.x = p.x; n.y = p.y; };
    if (c && kind === 'grow') {
      touch(c);
      c.r = R * FOCUS_SCALE;
      for (const [n, p] of pushAside(nodes.filter((n) => vis[n.index]), c, c.r)) move(n, p);
    } else if (c && kind === 'pull') {
      const around = neighboursOf(id);
      for (const [n, p] of pullAround(c, around, R)) move(n, p);
      // whatever else was in the way steps aside
      const taken = new Set([c, ...around]);
      const reach = Math.max(120, ...around.map((n) => Math.hypot(n.x - c.x, n.y - c.y))) + R * 5;
      const others = nodes.filter((n) => vis[n.index] && !taken.has(n));
      for (const [n, p] of relax(others, [c, ...around].map((n) => ({ x: n.x, y: n.y, r: R })), c, reach)) move(n, p);
    }
    if (prev.size) tweenFrom(prev);
  }

  /** Click on a gene (null: click on the background). Alone, a selected gene pulls the genes connected to it
   *  (visible edges) around it and they all shine; ctrl+click adds / removes genes (several selected: no pulling). */
  function select(id, { additive = false, notify = true } = {}) {
    if (id === null) { if (!sel.size) return; sel.clear(); }
    else if (additive) sel.has(id) ? sel.delete(id) : sel.add(id);
    else if (sel.size === 1 && sel.has(id)) sel.clear();
    else { sel.clear(); sel.add(id); }
    highlightId = null;
    applySelection(notify);
  }
  function applySelection(notify) {
    const one = sel.size === 1 ? [...sel][0] : null;
    linked = new Set(one ? neighboursOf(one).map((n) => n.id) : []);
    style();
    setFocus(one ? 'pull' : null, one);
    if (notify) onSelect?.([...sel]);
  }
  /** Visible edges, the score filter or the hidden lists changed: selected genes get their new neighbours. */
  function refocus() {
    if (!sel.size) return;
    const shown = new Set(nodes.filter((n) => vis[n.index]).map((n) => n.id));
    for (const id of [...sel]) if (!shown.has(id)) sel.delete(id);
    applySelection(false);
  }

  const shiny = (d) => d.id === highlightId || sel.has(d.id) || linked.has(d.id);

  /** (Re)apply node colours, visibility and highlight. */
  function style() {
    if (!nodeSel) return;
    nodeSel.attr('fill', nodeColor).attr('display', (d, i) => (vis[i] ? null : 'none'))
      .attr('stroke', (d) => (sel.has(d.id) ? '#000' : d.id === highlightId ? '#FFF3B0' : '#BDBDBD'))
      .attr('stroke-width', (d) => (sel.has(d.id) ? 3 : d.id === highlightId ? 2 : 1))
      .attr('filter', (d) => (shiny(d) ? 'url(#ng-glow)' : null))
      .classed('highlight', (d) => d.id === highlightId)
      .classed('selected', (d) => sel.has(d.id));
    nodeSel.filter(shiny).raise();
    nodeSel.filter((d) => sel.has(d.id)).raise();
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
    sel.clear(); linked = new Set();
    style();
    setFocus('grow', id);
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
    parts.splice(1, 0, svg.select('defs').node().outerHTML);
    const layer = nodeLayer.node().cloneNode(true);
    layer.querySelectorAll('[display="none"]').forEach((n) => n.remove());
    parts.push(new XMLSerializer().serializeToString(layer), '</g></svg>');
    return parts.join('');
  }

  return {
    setData,
    setColors(c) { colors = c; style(); requestPaint(); },
    setThreshold(v) { threshold = v; rebuildVisible(); refocus(); requestPaint(); },
    setHidden(set) { hidden = set; rebuildVisible(); refocus(); style(); requestPaint(); },
    highlight,
    clearHighlight() { if (highlightId === null) return; highlightId = null; style(); setFocus(null); },
    clearSelection() { select(null, { notify: false }); },
    selectedIds: () => [...sel],
    removeNodes,
    recluster, hasEdgesOf,
    setHiddenTypes(set) { hiddenTypes = set; rebuildVisible(); refocus(); requestPaint(); },
    zoomTo(k) { svg.transition().duration(150).call(zoom.scaleTo, Math.min(MAX_K, Math.max(MIN_K, k))); },
    zoomBy(f) { svg.transition().duration(200).call(zoom.scaleBy, f); },
    reset() { userMoved = false; fit(true); },
    toSvgString,
    size: () => ({ width, height }),
    destroy() { tweenTimer?.stop(); ro.disconnect(); clearTimeout(idleTimer); cancelAnimationFrame(raf); svg.remove(); canvas.remove(); },
  };
}
export const ZOOM_RANGE = [MIN_K, MAX_K];
