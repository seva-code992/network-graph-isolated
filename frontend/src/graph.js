import * as d3 from 'd3';
import { edgeWidth, idOf, nodeVisible } from './logic.js';

const R = 10;
const MIN_K = 0.125, MAX_K = 8;

/**
 * d3 force-directed network rendered as SVG.
 * Fill/stroke are set as attributes (not CSS) so the SVG can be exported as-is.
 */
export function createGraph(host, { tooltip, listName, onZoom, onBackgroundClick }) {
  const svg = d3.select(host).append('svg').attr('class', 'graph-svg').attr('role', 'img')
    .attr('aria-label', 'Gene network graph').style('touch-action', 'none');
  const viewport = svg.append('g').attr('class', 'viewport');
  const edgeLayer = viewport.append('g').attr('class', 'edges');
  const nodeLayer = viewport.append('g').attr('class', 'nodes');

  let nodes = [], edges = [], sim = null, edgeSel, hitSel, nodeSel;
  let colors = { nodes: {}, edges: {} };
  let threshold = 0, hidden = new Set(), highlightId = null;
  let userMoved = false, width = 800, height = 400;

  // ----- zoom: ctrl+wheel / touchpad pinch (wheel + ctrlKey), drag background to pan -----
  const zoom = d3.zoom().scaleExtent([MIN_K, MAX_K])
    .filter((e) => (e.type === 'wheel' ? e.ctrlKey : !e.ctrlKey && !e.button && e.type !== 'dblclick'))
    .on('zoom', (e) => {
      viewport.attr('transform', e.transform);
      if (e.sourceEvent) userMoved = true;
      onZoom?.(e.transform.k);
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (e) => { if (e.target === svg.node()) onBackgroundClick?.(); });

  const ro = new ResizeObserver(() => {
    width = host.clientWidth || width; height = host.clientHeight || height;
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    if (sim) sim.force('center', d3.forceCenter(width / 2, height / 2)); // keep layout centred
    if (!userMoved && nodes.length) fit(false);
  });
  ro.observe(host);

  // ----- tooltip -----
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

  const nodeColor = (n) => colors.nodes[n.lists[0]] || '#999';
  const edgeColor = (d) => colors.edges[d.type] || '#000';

  // ----- data -----
  function setData(newNodes, newEdges) {
    sim?.stop();
    nodes = newNodes.map((n) => ({ ...n }));
    edges = newEdges.map((e) => ({ ...e }));
    highlightId = null;
    userMoved = false;
    edgeLayer.selectAll('*').remove();
    nodeLayer.selectAll('*').remove();
    svg.call(zoom.transform, d3.zoomIdentity);

    // spread the start so the simulation doesn't begin from a single point
    nodes.forEach((n, i) => {
      const a = i * 2.399963, r = 14 * Math.sqrt(i + 1);
      n.x = width / 2 + r * Math.cos(a); n.y = height / 2 + r * Math.sin(a);
    });
    sim = d3.forceSimulation(nodes)
      // stronger / shorter links for higher scores -> well-connected genes cluster slightly
      .force('link', d3.forceLink(edges).id((d) => d.id).distance((d) => 120 - 70 * d.score)
        .strength((d) => 0.1 + 0.5 * d.score))
      .force('charge', d3.forceManyBody().strength(-110).distanceMax(400))
      .force('collide', d3.forceCollide(R + 3))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.06))
      .stop();
    sim.tick(Math.min(300, 60 + nodes.length));   // settle before the first paint
    sim.on('tick', draw).alpha(0.05).restart();

    edgeSel = edgeLayer.selectAll('line.edge').data(edges).join('line').attr('class', 'edge')
      .attr('stroke-linecap', 'round').attr('stroke-opacity', 0.8);
    hitSel = edgeLayer.selectAll('line.hit').data(edges).join('line').attr('class', 'hit')
      .attr('stroke', 'transparent').attr('stroke-width', 8)
      .on('mousemove', (ev, d) => showTip(ev, [
        el('div', 'tip-title', `${d.type === 'annotation' ? 'Annotation similarity' : 'Expression score'}: ${d.score.toFixed(2)}`),
        el('div', 'tip-sub', `${idOf(d.source)} — ${idOf(d.target)}`)]))
      .on('mouseleave', hideTip);
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
        .on('start', (ev, d) => { hideTip(); if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev) => { if (!ev.active) sim.alphaTarget(0); style(); })); // fx/fy kept -> pinned
    style();
    draw();
    fit(false);
  }

  function draw() {
    const pos = (s) => s.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    pos(edgeSel); pos(hitSel);
    nodeSel.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
  }

  /** (Re)apply colours, visibility, highlight. Cheap – called for every state change. */
  function style() {
    if (!nodeSel) return;
    const vis = new Map(nodes.map((n) => [n.id, nodeVisible(n, hidden)]));
    const edgeOn = (d) => d.score > threshold && vis.get(idOf(d.source)) && vis.get(idOf(d.target));
    edgeSel.attr('stroke', edgeColor).attr('stroke-width', (d) => edgeWidth(d.score))
      .attr('display', (d) => (edgeOn(d) ? null : 'none'));
    hitSel.attr('display', (d) => (edgeOn(d) ? null : 'none'));
    nodeSel.attr('fill', nodeColor).attr('display', (d) => (vis.get(d.id) ? null : 'none'))
      .attr('stroke', (d) => (d.id === highlightId ? '#000' : d.fx != null ? '#424753' : '#BDBDBD'))
      .attr('stroke-width', (d) => (d.id === highlightId ? 4 : d.fx != null ? 2 : 1))
      .classed('highlight', (d) => d.id === highlightId);
    nodeSel.filter((d) => d.id === highlightId).raise();
  }

  // ----- view -----
  function fit(animate = true) {
    const vis = nodes.filter((n) => nodeVisible(n, hidden));
    if (!vis.length) return;
    const [x0, x1] = d3.extent(vis, (n) => n.x), [y0, y1] = d3.extent(vis, (n) => n.y);
    const pad = 50, w = x1 - x0 + 2 * R, h = y1 - y0 + 2 * R;
    const k = Math.min(1.5, Math.max(MIN_K, Math.min((width - pad * 2) / w, (height - pad * 2) / h)));
    const t = d3.zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, height / 2 - (k * (y0 + y1)) / 2).scale(k);
    const target = animate ? svg.transition().duration(450) : svg;
    target.call(zoom.transform, t);
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

  return {
    setData,
    setColors(c) { colors = c; style(); },
    setThreshold(v) { threshold = v; style(); },
    setHidden(set) { hidden = set; style(); },
    highlight,
    clearHighlight() { highlightId = null; style(); },
    zoomTo(k) { svg.transition().duration(150).call(zoom.scaleTo, Math.min(MAX_K, Math.max(MIN_K, k))); },
    zoomBy(f) { svg.transition().duration(200).call(zoom.scaleBy, f); },
    reset() { userMoved = false; fit(true); },
    svgNode: () => svg.node(),
    destroy() { sim?.stop(); ro.disconnect(); svg.remove(); },
  };
}
export const ZOOM_RANGE = [MIN_K, MAX_K];
