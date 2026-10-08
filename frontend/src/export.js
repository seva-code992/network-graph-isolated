import { matrixTsv } from './logic.js';

function download(name, blob) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function svgString(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('.hit').forEach((n) => n.remove());      // invisible hover helpers
  clone.querySelectorAll('[display="none"]').forEach((n) => n.remove());
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export function exportSvg(svg, name) {
  download(`${name}.svg`, new Blob([svgString(svg)], { type: 'image/svg+xml' }));
}

export async function exportPng(svg, name, scale = 2) {
  const w = svg.clientWidth, h = svg.clientHeight;
  const url = URL.createObjectURL(new Blob([svgString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((res, rej) => Object.assign(new Image(), { onload() { res(this); }, onerror: rej, src: url }));
    const canvas = Object.assign(document.createElement('canvas'), { width: w * scale, height: h * scale });
    canvas.getContext('2d').drawImage(img, 0, 0, w * scale, h * scale);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    download(`${name}.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportTsv(nodes, edges, name) {
  download(`${name}.tsv`, new Blob([matrixTsv(nodes, edges)], { type: 'text/tab-separated-values' }));
}
