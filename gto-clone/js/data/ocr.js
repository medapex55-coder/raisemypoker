// Reading the text written on a chart screenshot (its title: "CO open 20bb"),
// in the browser with Tesseract.js. The image never leaves the computer; the
// engine and its English data (about 5 MB) download once, on first use.
const SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let worker = null;

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

// The text of an ImageData, with the chart's grid hidden (its 169 hand names
// would only add noise). Small images are enlarged: Tesseract reads better.
export async function readText(img, rect) {
  const k = Math.max(1, Math.min(3, 1600 / Math.max(img.width, img.height)));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  src.getContext('2d').putImageData(img, 0, 0);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (rect) {
    const d = img.data; // fill the grid with the corner color: the background
    ctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
    ctx.fillRect(rect.x0 * k - 2, rect.y0 * k - 2, (rect.x1 - rect.x0) * k + 4, (rect.y1 - rect.y0) * k + 4);
  }
  // Gray levels, dark text on light: light titles on a dark theme are inverted.
  const px = ctx.getImageData(0, 0, c.width, c.height), p = px.data;
  const dark = (p[0] + p[1] + p[2]) / 3 < 128;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    p[i] = p[i + 1] = p[i + 2] = dark ? 255 - g : g;
  }
  ctx.putImageData(px, 0, 0);
  const w = await getWorker();
  const { data } = await w.recognize(c);
  return data.text || '';
}
