// Reading a chart from a screenshot (.png, .jpg): find the 13x13 grid, take
// the main color of the left and right half of each cell, group the colors,
// and turn them into chart codes once each color has an action. Pure
// functions on ImageData-like objects ({ data, width, height }), no DOM.

export const OPEN_ACTIONS = [['R', 'Raise'], ['A', 'All-in'], ['M', 'Limp'], ['F', 'Fold'], ['L', 'Loosifie'], ['T', 'Tightfie']];
export const BB_ACTIONS = [['R', '3bet / raise'], ['A', 'All-in'], ['C', 'Call'], ['K', 'Check'], ['F', 'Fold'], ['B', '3bet light'], ['n', 'Hors range']];
// A cell with two colors -> the chart's split code. Key: the two codes sorted.
const SPLIT = {
  open: { RT: 'X', MR: 'H', AM: 'a', FM: 'm', FR: 'X' },
  bb: { CR: 'r', CF: 'c', AC: 'a', AR: 'j', KR: 'r' },
};
export function splitCode(type, a, b) {
  if (a === b) return a;
  return SPLIT[type][[a, b].sort().join('')] || a;
}
// Every code a cell can take, in the order a click cycles through them.
export const CELL_CODES = { open: 'RAMFLTXHam', bb: 'RACKFBrcajn' };

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function pixel(img, x, y) {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

// The most common color among some pixels (16 levels per channel), averaged
// over the pixels of that bin. Label text in a cell is a minority: it loses.
function dominant(pxs) {
  const bins = new Map();
  for (const p of pxs) {
    const k = (p[0] >> 4) * 256 + (p[1] >> 4) * 16 + (p[2] >> 4);
    const b = bins.get(k) || { n: 0, s: [0, 0, 0] };
    b.n++; b.s[0] += p[0]; b.s[1] += p[1]; b.s[2] += p[2];
    bins.set(k, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  return best.s.map((v) => Math.round(v / best.n));
}

// The grid's box: the longest band of rows (then columns) that differ from
// the background, allowing the thin gaps between cells. { x0, y0, x1, y1 }.
export function detectGrid(img) {
  const { width: w, height: h } = img;
  const border = [];
  for (let x = 0; x < w; x += 4) border.push(pixel(img, x, 0), pixel(img, x, h - 1));
  for (let y = 0; y < h; y += 4) border.push(pixel(img, 0, y), pixel(img, w - 1, y));
  const bg = dominant(border);
  const on = (x, y) => dist(pixel(img, x, y), bg) > 40;
  const band = (n, dens) => {
    const max = Math.max(...dens);
    const thr = 0.5 * max, gap = Math.max(2, Math.round(n * 0.015));
    let best = [0, n - 1], bestLen = 0, start = -1, last = -1;
    for (let i = 0; i <= n; i++) {
      const hit = i < n && dens[i] >= thr;
      if (hit) { if (start < 0 || i - last > gap) start = i; last = i; if (last - start > bestLen) { bestLen = last - start; best = [start, last]; } }
    }
    return best;
  };
  const step = Math.max(1, Math.round(Math.max(w, h) / 500));
  const rowD = [];
  for (let y = 0; y < h; y++) { let c = 0, t = 0; for (let x = 0; x < w; x += step) { t++; if (on(x, y)) c++; } rowD.push(c / t); }
  const [y0, y1] = band(h, rowD);
  const colD = [];
  for (let x = 0; x < w; x++) { let c = 0, t = 0; for (let y = y0; y <= y1; y += step) { t++; if (on(x, y)) c++; } colD.push(c / t); }
  const [x0, x1] = band(w, colD);
  if (x1 - x0 < 52 || y1 - y0 < 52) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// Main color of the left and right half of each of the 169 cells (row-major,
// aces top-left). The top of the cell is skipped: that's where labels sit.
export function sampleCells(img, rect) {
  const cw = (rect.x1 - rect.x0) / 13, ch = (rect.y1 - rect.y0) / 13;
  const XS = { l: [0.12, 0.2, 0.28, 0.36, 0.44], r: [0.56, 0.64, 0.72, 0.8, 0.88] };
  const YS = [0.5, 0.58, 0.66, 0.74, 0.82, 0.88];
  const cells = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const at = (fx, fy) => pixel(img, Math.min(img.width - 1, rect.x0 + (col + fx) * cw), Math.min(img.height - 1, rect.y0 + (row + fy) * ch));
      cells.push({
        l: dominant(XS.l.flatMap((fx) => YS.map((fy) => at(fx, fy)))),
        r: dominant(XS.r.flatMap((fx) => YS.map((fy) => at(fx, fy)))),
      });
    }
  }
  return cells;
}

// Groups the half-cell colors: { clusters: [{ rgb, count }], of: [[l, r] x169] }.
// Rare colors (anti-aliasing, JPEG noise) join the nearest common one.
export function clusterColors(cells) {
  const all = cells.flatMap((c) => [c.l, c.r]);
  let cl = [];
  for (const p of all) {
    const near = cl.find((c) => dist(c.rgb, p) < 45);
    if (near) { near.sum = near.sum.map((v, k) => v + p[k]); near.count++; near.rgb = near.sum.map((v) => v / near.count); }
    else cl.push({ rgb: p.slice(), sum: p.slice(), count: 1 });
  }
  const min = Math.max(2, all.length * 0.006);
  const big = cl.filter((c) => c.count >= min);
  cl = (big.length ? big : cl).map((c) => ({ rgb: c.rgb.map(Math.round), count: 0 }));
  const idx = (p) => cl.reduce((b, c, i) => (dist(c.rgb, p) < dist(cl[b].rgb, p) ? i : b), 0);
  const of = cells.map((c) => { const a = [idx(c.l), idx(c.r)]; cl[a[0]].count++; cl[a[1]].count++; return a; });
  // Most common color first.
  const order = cl.map((c, i) => i).sort((a, b) => cl[b].count - cl[a].count);
  const pos = new Map(order.map((o, i) => [o, i]));
  return { clusters: order.map((o) => cl[o]), of: of.map(([a, b]) => [pos.get(a), pos.get(b)]) };
}

// A first guess of a color's action, from its hue; the user corrects it.
export function guessCode(rgb, type) {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
    else hue = 60 * ((r - g) / (max - min) + 4);
  }
  if (hue < 0) hue += 360;
  if (s < 0.18 || l > 0.9 || l < 0.1) return type === 'bb' && l > 0.9 ? 'n' : 'F';
  if (hue >= 330 || hue < 45) return l < 0.33 ? 'A' : 'R';
  if (hue < 75) return type === 'open' ? 'L' : 'R';
  if (hue < 170) return type === 'open' ? 'M' : 'C';
  if (hue < 260) return 'F';
  return type === 'open' ? 'A' : 'B';
}

// 13 rows of codes from the clusters' actions, plus the user's fixes by cell.
export function gridFrom(type, of, codes, fixes = new Map()) {
  const rows = [];
  for (let row = 0; row < 13; row++) {
    let line = '';
    for (let col = 0; col < 13; col++) {
      const i = row * 13 + col;
      line += fixes.get(i) || splitCode(type, codes[of[i][0]], codes[of[i][1]]);
    }
    rows.push(line);
  }
  return rows;
}

// Downscaled ImageData of a loaded image (the longest side at most `max` px).
export function imageDataOf(img, max = 1400) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}
