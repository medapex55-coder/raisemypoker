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

// ---------- the legend ----------
// Words of a chart's legend, by action (French and English).
const ACTION_WORDS = [
  // Common OCR slips are accepted: l / I / 1 and O / 0 swapped.
  ['light', /^([L1I]IGHT|L[1I]GHT|BLUFFS?)$/],
  ['allin', /^(ALL-?[I1L]N|SHOVES?|JAM|PUSH|TAPIS|AI)$/],
  ['raise', /^(RA[I1L]SES?|RELANCER?|[34]-?BETS?|[I1]SO|[I1]SOLATE|[I1]SOLAT[I1]ON|BET)$/],
  ['call', /^(CA[L1I]{1,2}S?|SU[I1]VRE|SU[I1]T|PAYER?|COLD-?CALL|FLAT)$/],
  ['check', /^(CHECKS?)$/],
  ['limp', /^([L1I][I1L]MPS?|COMPL[EÈ]TER?)$/],
  ['fold', /^(F[O0][L1I]DS?|COUCHER?|PASSE)$/],
  ['loose', /^([L1I][O0]{2}S[I1L]F[I1L]E|[L1I][O0]{2}S[I1L]FY|[L1I][O0]{2}SER?)$/],
  ['tight', /^(T[I1L]GHTF[I1L]E|T[I1L]GHT[I1L]FY|T[I1L]GHTFY|T[I1L]GHTER?)$/],
];
const CODE_OF = {
  open: { raise: 'R', allin: 'A', limp: 'M', call: 'M', fold: 'F', loose: 'L', tight: 'T', light: 'R', check: 'F' },
  bb: { raise: 'R', allin: 'A', call: 'C', check: 'K', fold: 'F', light: 'B', limp: 'C' },
};
const SEAT_IN_LINE = /\b(LJ|HJ|CO|BTN|BU|SB|UTG|MP|CUTOFF|BUTTON|BOUTON|HIJACK|LOJACK|VS)\b/;

// The main color of a box, leaving out the background.
function boxColor(img, bg, x0, y0, x1, y1) {
  const pxs = [];
  const sx = Math.max(1, (x1 - x0) / 14), sy = Math.max(1, (y1 - y0) / 8);
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += sy) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x += sx) {
      const p = pixel(img, x, y);
      if (dist(p, bg) > 40) pxs.push(p);
    }
  }
  return pxs.length >= 4 ? dominant(pxs) : null;
}

const sameLine = (a, b) => Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < 0.5 * Math.max(a.y1 - a.y0, b.y1 - b.y0);

// A word drawn on a filled box: the ring just around the word is one color,
// not the background. Returns that color or null.
function boxFill(img, bg, w) {
  const m = Math.max(3, (w.y1 - w.y0) * 0.25);
  const ring = [];
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const x = w.x0 + ((w.x1 - w.x0) * k) / n, y = w.y0 + ((w.y1 - w.y0) * k) / n;
    ring.push([x, w.y0 - m], [x, w.y1 + m], [w.x0 - m, y], [w.x1 + m, y]);
  }
  const pxs = ring.filter(([x, y]) => x >= 0 && y >= 0 && x < img.width && y < img.height).map(([x, y]) => pixel(img, x, y));
  const col = pxs.filter((p) => dist(p, bg) > 40);
  return col.length > pxs.length * 0.7 ? dominant(col) : null;
}

// The colored run nearest to the word on one side (dir -1 left, 1 right),
// within a gap of about one letter height: a legend's swatch.
function nearRun(img, bg, w, dir) {
  const hgt = Math.max(6, w.y1 - w.y0);
  const ys = [0.35, 0.5, 0.65].map((f) => w.y0 + (w.y1 - w.y0) * f);
  const start = dir < 0 ? w.x0 - 2 : w.x1 + 2;
  for (let gap = 0; gap < 1.5 * hgt; gap++) {
    const x = start + dir * gap;
    if (x < 0 || x >= img.width) return null;
    const hits = ys.map((y) => pixel(img, x, y)).filter((p) => dist(p, bg) > 40);
    if (hits.length >= 2) {
      // Found its edge: take the run up to its other edge (at most 3 heights).
      const pxs = [];
      for (let d = 0; d < 3 * hgt; d++) {
        const xx = x + dir * d;
        if (xx < 0 || xx >= img.width) break;
        const row = ys.map((y) => pixel(img, xx, y)).filter((p) => dist(p, bg) > 40);
        if (row.length < 2) break;
        pxs.push(...row);
      }
      return pxs.length >= 6 ? dominant(pxs) : null;
    }
  }
  return null;
}

// Legend entries read from the OCR words: [{ action, word, colors }], colors
// being the candidates around the word (its own box, a swatch on its left or
// right). Words of the title line (positions, "vs") don't count.
export function legendEntries(img, words) {
  const border = [];
  for (let x = 0; x < img.width; x += 4) border.push(pixel(img, x, 0), pixel(img, x, img.height - 1));
  const bg = dominant(border);
  const out = [];
  const norm = words.map((w) => ({ ...w, key: String(w.text).toUpperCase().replace(/^[^\wÀ-Ü-]+|[^\wÀ-Ü-]+$/g, '') }));
  norm.forEach((w, i) => {
    if (w.line && SEAT_IN_LINE.test(w.line.toUpperCase())) return;
    let action = ACTION_WORDS.find(([, re]) => re.test(w.key))?.[0];
    if (!action && w.key === 'ALL' && norm[i + 1]?.key === 'IN') action = 'allin';
    if (!action) return;
    // "3bet light": the 3bet word belongs to the light entry.
    if (action === 'raise' && /^(LIGHT|BLUFF)/.test(norm[i + 1]?.key || '') && Math.abs(norm[i + 1].y0 - w.y0) < (w.y1 - w.y0)) return;
    const hgt = Math.max(6, w.y1 - w.y0);
    if (w.rgb) { out.push({ action, word: w.text, colors: [w.rgb] }); return; } // read inside its colored box
    // Its color: the word sits in a colored box (the box around the word is
    // filled), else a swatch right before it, else one right after it. Only
    // what touches the word counts: never the next entry's swatch.
    // The entry may be several words ("3bet light", "all in"): its swatch is
    // before the first one, its box around all of them.
    const joins = (a, b) => a && b && sameLine(a, b) && b.x0 - a.x1 < 0.9 * hgt;
    let first = i;
    if (/^(LIGHT|BLUFF|IN)$/.test(w.key) && /^(3-?BET|ALL)$/.test(norm[i - 1]?.key || '') && joins(norm[i - 1], w)) first = i - 1;
    let last = i;
    if (/^(3-?BET|ALL)$/.test(w.key) && /^(LIGHT|BLUFF|IN)$/.test(norm[i + 1]?.key || '') && joins(w, norm[i + 1])) last = i + 1;
    const phrase = { x0: norm[first].x0, x1: norm[last].x1, y0: Math.min(w.y0, norm[first].y0), y1: Math.max(w.y1, norm[first].y1) };
    const inBox = boxFill(img, bg, phrase);
    const swatch = inBox ? null : nearRun(img, bg, phrase, -1) || nearRun(img, bg, phrase, 1);
    const colors = [inBox || swatch].filter(Boolean);
    if (colors.length) out.push({ action, word: w.text, colors });
  });
  return out;
}

// Filled colored boxes outside the grid (legend buttons with their label
// written inside): [{ x0, y0, x1, y1, rgb }] in pixels. Found on a coarse
// mask of "not background" pixels; a box is wide, not too tall, well filled.
// With { any: true }: every solid block, square swatches included.
export function colorBoxes(img, rect, { any = false } = {}) {
  const border = [];
  for (let x = 0; x < img.width; x += 4) border.push(pixel(img, x, 0), pixel(img, x, img.height - 1));
  const bg = dominant(border);
  const s = Math.max(2, Math.round(Math.max(img.width, img.height) / 600));
  const W = Math.ceil(img.width / s), H = Math.ceil(img.height / s);
  const m = 4;
  const mask = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i * s, y = j * s;
      if (rect && x > rect.x0 - m && x < rect.x1 + m && y > rect.y0 - m && y < rect.y1 + m) continue;
      if (dist(pixel(img, Math.min(x, img.width - 1), Math.min(y, img.height - 1)), bg) > 40) mask[j * W + i] = 1;
    }
  }
  const seen = new Uint8Array(W * H), out = [];
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (stack.length) {
      const q = stack.pop(), i = q % W, j = (q - i) / W;
      n++; x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const r = b * W + a;
        if (mask[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
    }
    const bw = (x1 - x0 + 1) * s, bh = (y1 - y0 + 1) * s;
    const fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (any ? bw < 8 || bh < 8 || bh > 150 || bw > img.width * 0.6 || fill < 0.8
      : bh < 12 || bh > 120 || bw < 1.5 * bh || bw > img.width * 0.6 || fill < 0.6) continue;
    const box = { x0: x0 * s, y0: y0 * s, x1: (x1 + 1) * s, y1: (y1 + 1) * s };
    const pxs = [];
    for (let y = box.y0 + 2; y < box.y1 - 2; y += 2) for (let x = box.x0 + 2; x < box.x1 - 2; x += 3) pxs.push(pixel(img, Math.min(x, img.width - 1), Math.min(y, img.height - 1)));
    out.push({ ...box, rgb: dominant(pxs) });
  }
  return out;
}

// Chart type the legend suggests: calls, checks and light 3bets are the BB's.
export function legendType(entries) {
  const acts = new Set(entries.map((e) => e.action));
  if (acts.has('call') || acts.has('check') || acts.has('light')) return 'bb';
  if (acts.has('limp') || acts.has('loose') || acts.has('tight')) return 'open';
  return null;
}

// For each color cluster, the legend's code when a legend color matches it
// (closest match wins), else null.
export function legendCodes(entries, clusters, type) {
  const best = clusters.map(() => ({ d: 55, code: null, word: null }));
  for (const e of entries) {
    const code = CODE_OF[type][e.action];
    if (!code) continue;
    for (const col of e.colors) {
      clusters.forEach((c, i) => {
        const d = dist(col, c.rgb);
        if (d < best[i].d) best[i] = { d, code, word: e.word };
      });
    }
  }
  return best.map((b) => (b.code ? { code: b.code, word: b.word } : null));
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
