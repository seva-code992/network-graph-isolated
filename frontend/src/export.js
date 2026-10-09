import { matrixTsv } from './logic.js';

function download(name, blob) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportSvg(svgText, name) {
  download(`${name}.svg`, new Blob([svgText], { type: 'image/svg+xml' }));
}

export async function exportPng(svgText, { width, height }, name, scale = 2) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((res, rej) => Object.assign(new Image(), { onload() { res(this); }, onerror: rej, src: url }));
    const canvas = Object.assign(document.createElement('canvas'), { width: width * scale, height: height * scale });
    canvas.getContext('2d').drawImage(img, 0, 0, width * scale, height * scale);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    download(`${name}.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportTsv(nodes, edges, name) {
  download(`${name}.tsv`, new Blob([matrixTsv(nodes, edges)], { type: 'text/tab-separated-values' }));
}
