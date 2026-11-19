// Reading the text written on a chart screenshot (its title "CO open 20bb",
// its legend "Raise / Fold / ..."), in the browser with Tesseract.js. The
// image never leaves the computer; the engine and its English data (about
// 5 MB) download once, on first use.
import { colorBoxes } from './chart-image.js';

const SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let worker = null;
let queue = Promise.resolve(); // one image at a time: the reads change the worker's settings

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true;
    s.onload = ok; s.onerror = () => ko(new Error('moteur de lecture indisponible (hors ligne ?)'));
    document.head.append(s);
  });
}

function getWorker() {
  worker ||= loadScript().then(() => window.Tesseract.createWorker('eng')).catch((e) => { worker = null; throw e; });
  return worker;
}

function canvasOf(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

const wordsOf = (data, k, dx = 0, dy = 0) => (data.words?.length ? data.words : (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))))
  .filter((wd) => wd.confidence > 15)
  .map((wd) => ({ text: wd.text, conf: wd.confidence, line: wd.line?.text, x0: dx + wd.bbox.x0 / k, y0: dy + wd.bbox.y0 / k, x1: dx + wd.bbox.x1 / k, y1: dy + wd.bbox.y1 / k }));

// The text of an ImageData: { text, words: [{ text, x0, y0, x1, y1, rgb? }] }
// in the ImageData's pixels. The chart's grid is hidden (its 169 hand names
// would only add noise); words written inside a colored box carry its rgb.
export function readText(img, rect) {
  const job = queue.then(() => read(img, rect));
  queue = job.catch(() => {});
  return job;
}

async function read(img, rect) {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  // 1. The whole image, enlarged, gray, dark text on light, grid hidden.
  //    Read twice: as it is (the title), then with the solid blocks erased
  //    (a legend swatch next to a word gets read as a letter: '"Fold').
  const k = Math.max(1, Math.min(3, 1600 / Math.max(img.width, img.height)));
  const d = img.data; // the corner color: the background
  const blocks = colorBoxes(img, rect, { any: true });
  const page = async (erase) => {
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvasOf(img), 0, 0, c.width, c.height);
    ctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
    if (rect) ctx.fillRect(rect.x0 * k - 2, rect.y0 * k - 2, (rect.x1 - rect.x0) * k + 4, (rect.y1 - rect.y0) * k + 4);
    if (erase) for (const b of blocks) ctx.fillRect(b.x0 * k - 1, b.y0 * k - 1, (b.x1 - b.x0) * k + 2, (b.y1 - b.y0) * k + 2);
    const px = ctx.getImageData(0, 0, c.width, c.height), p = px.data;
    const dark = (p[0] + p[1] + p[2]) / 3 < 128;
    for (let i = 0; i < p.length; i += 4) {
      const g = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
      p[i] = p[i + 1] = p[i + 2] = dark ? 255 - g : g;
    }
    ctx.putImageData(px, 0, 0);
    const { data } = await w.recognize(c, {}, { text: true, blocks: true });
    return { text: data.text || '', words: wordsOf(data, k) };
  };
  const overlaps = (u, v) => u.x0 < v.x1 && v.x0 < u.x1 && u.y0 < v.y1 && v.y0 < u.y1;
  const a = await page(false);
  let { text } = a;
  const words = a.words;
  if (blocks.length) {
    const b = await page(true);
    // Its words that the first read missed or garbled ('"Fold' -> 'Fold').
    for (const wb of b.words) {
      const hit = words.findIndex((wa) => overlaps(wa, wb));
      if (hit < 0) words.push(wb);
      else if (/^[^A-Za-z0-9]/.test(words[hit].text) && /^[A-Za-z0-9]/.test(wb.text)) words[hit] = wb;
    }
  }

  // 2. Each colored box outside the grid (a legend button, a title banner),
  // read on its own: its color turned white, the text dark in proportion to
  // how far it is from that color (soft edges read better than hard ones).
  // The box's own border (3px) is left out.
  await w.setParameters({ tessedit_pageseg_mode: '7' }); // one line of text
  const src = canvasOf(img);
  for (const b of colorBoxes(img, rect).slice(0, 16)) {
    const kk = Math.max(2, 64 / (b.y1 - b.y0)), ins = 3;
    const bw = b.x1 - b.x0 - 2 * ins, bh = b.y1 - b.y0 - 2 * ins;
    const bc = document.createElement('canvas');
    bc.width = Math.round((bw + 16) * kk); bc.height = Math.round((bh + 16) * kk);
    const bx = bc.getContext('2d');
    bx.fillStyle = '#fff'; bx.fillRect(0, 0, bc.width, bc.height);
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(src, b.x0 + ins, b.y0 + ins, bw, bh, 8 * kk, 8 * kk, bw * kk, bh * kk);
    const bp = bx.getImageData(0, 0, bc.width, bc.height), q = bp.data;
    for (let i = 0; i < q.length; i += 4) {
      const d = Math.hypot(q[i] - b.rgb[0], q[i + 1] - b.rgb[1], q[i + 2] - b.rgb[2]);
      q[i] = q[i + 1] = q[i + 2] = 255 - Math.min(255, d * 2);
    }
    bx.putImageData(bp, 0, 0);
    // The margin around the box stays white.
    bx.fillStyle = '#fff';
    bx.fillRect(0, 0, bc.width, 8 * kk); bx.fillRect(0, bc.height - 8 * kk, bc.width, 8 * kk);
    bx.fillRect(0, 0, 8 * kk, bc.height); bx.fillRect(bc.width - 8 * kk, 0, 8 * kk, bc.height);
    const r = await w.recognize(bc, {}, { text: true, blocks: true });
    const inBox = wordsOf(r.data, kk, b.x0 + ins - 8, b.y0 + ins - 8).map((wd) => ({ ...wd, rgb: b.rgb, line: r.data.text }));
    if (inBox.length) { words.push(...inBox); text += '\n' + r.data.text; }
  }
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  return { text, words };
}
