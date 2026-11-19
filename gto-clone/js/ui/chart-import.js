// Study's "Importer des chartes" dialog: files (.txt, .json, several at once),
// a preview of every chart read, then they join the solver. Below, the 6-max
// spots that still have no chart at each stack.
import { h, mount, modal, toast } from './dom.js';
import { CLASSES } from '../engine/cards.js';
import {
  parseChartText, addUserCharts, getUserCharts, removeUserChart, clearUserCharts, chartLabel, TEMPLATE, exportJson, OPEN_SEATS, BB_VS, guessSpot, spotFromText, validate,
} from '../data/user-charts.js';
import {
  detectGrid, sampleCells, clusterColors, guessCode, gridFrom, imageDataOf, OPEN_ACTIONS, BB_ACTIONS, CELL_CODES,
} from '../data/chart-image.js';
import { STACKS } from '../engine/game.js';
import { readText } from '../data/ocr.js';
import { hasChart } from '../engine/strategy.js';

const OPEN_COLORS = { R: 'var(--act-bet-m)', A: 'var(--act-allin)', M: 'var(--act-call)', F: 'var(--act-fold)', L: 'var(--tag-loose)', T: 'var(--tag-tight)' };
const BB_COLORS = { R: 'var(--act-bet-m)', A: 'var(--act-allin)', C: 'var(--act-call)', K: 'var(--act-call)', F: 'var(--act-fold)', B: 'var(--tag-light)', n: 'transparent' };
const HALF = {
  open: { X: ['R', 'T'], H: ['R', 'M'], a: ['A', 'M'], m: ['M', 'F'] },
  bb: { r: ['R', 'C'], c: ['C', 'F'], a: ['A', 'C'], j: ['A', 'R'], q: ['C', 'C'] },
};

// A small 13x13 picture of a chart, colored by its codes. With onCell, each
// cell is a button (the image reader's fixes).
function MiniChart(c, onCell) {
  const colors = c.type === 'open' ? OPEN_COLORS : BB_COLORS;
  return h('div.mini-chart' + (onCell ? '.edit' : ''), onCell ? { role: 'group', 'aria-label': 'Aperçu modifiable' } : { role: 'img', 'aria-label': chartLabel(c) }, CLASSES.map((cls) => {
    const code = c.grid[cls.row][cls.col];
    const half = HALF[c.type][code];
    const bg = half ? `linear-gradient(90deg, ${colors[half[0]]} 50%, ${colors[half[1]]} 50%)` : colors[code];
    return onCell
      ? h('button', { type: 'button', title: `${cls.name} : ${code}`, 'aria-label': `${cls.name} : ${code}`, style: { background: bg }, on: { click: () => onCell(cls.id) } }, h('span.mini-lbl', cls.name))
      : h('span', { title: `${cls.name} : ${code}`, style: { background: bg } });
  }));
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The 6-max spots with no chart (built-in or imported) at each stack the user plays.
const COVER_STACKS = [100, 50, 25, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
const SPOT_NAMES = {
  open: { LJ: 'Open LJ', HJ: 'Open HJ', CO: 'Open CO', BTN: 'Open BTN', SB: 'Open SB' },
  bb: { LJ: 'BB vs open LJ', HJ: 'BB vs open HJ', CO: 'BB vs open CO', BTN: 'BB vs open BTN', SB: 'BB vs open SB', vsLimp: 'BB vs limp SB', vsLimp3bet: 'BB vs limp-relance SB', vsLimpShove: 'BB vs limp-tapis SB' },
};
function missingSpots() {
  let total = 0;
  const rows = COVER_STACKS.map((stack) => {
    const miss = [...OPEN_SEATS.map((s) => ['open', s]), ...BB_VS.map((s) => ['bb', s])].filter(([t, s]) => !hasChart(t, s, stack));
    total += miss.length;
    return h('li.miss-row',
      h('strong.mono', stack + 'bb'),
      miss.length
        ? h('span.miss-spots', miss.map(([t, s]) => h('span.miss-tag' + (t === 'bb' ? '.bb' : ''), SPOT_NAMES[t][s])))
        : h('span.small.pos', '✓ toutes les chartes sont là'));
  });
  return h('section.import-missing',
    h('div.panel-title', `Spots sans charte · 6-max (${total})`),
    h('p.small.muted', 'Sans charte, le solver joue l\'équilibre tapis / fold (15bb et moins), la charte la plus proche, ou son modèle.'),
    h('ul.miss-list', rows));
}

const IMAGE_RE = /\.(png|jpe?g|jfif|webp|gif|bmp)$/i;
const loadImage = (file) => new Promise((ok, ko) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { ok(img); URL.revokeObjectURL(url); };
  img.onerror = () => { ko(new Error('image illisible')); URL.revokeObjectURL(url); };
  img.src = url;
});

// One screenshot being read: the grid's frame (drag on the image to redraw
// it), the action of each color, the spot, and a preview where a click on a
// cell changes its code. onAdd(chart) when the user validates it.
function ImageEditor(file, img, { onAdd, onClose }) {
  const data = imageDataOf(img);
  const spot = guessSpot(file.name);
  const st = { type: spot.type || 'open', seat: spot.seat, stack: STACKS.includes(spot.stack) ? spot.stack : null, rect: detectGrid(data), fixes: new Map() };
  let read, codes, touched = false, userSpot = false;
  // Only the SB limps first in: elsewhere a green is a Loosifie.
  const guess = () => { codes = read.clusters.map((c) => { const k = guessCode(c.rgb, st.type); return k === 'M' && st.seat && st.seat !== 'SB' ? 'L' : k; }); };
  // A new frame: colors the user already named keep their action (nearest old color).
  const analyse = () => {
    const prev = read && touched ? read.clusters.map((c, i) => [c.rgb, codes[i]]) : null;
    read = clusterColors(sampleCells(data, st.rect));
    if (!prev) guess();
    else codes = read.clusters.map((c) => prev.reduce((b, p) => (Math.hypot(...p[0].map((v, k) => v - c.rgb[k])) < b[0] ? [Math.hypot(...p[0].map((v, k) => v - c.rgb[k])), p[1]] : b), [1e9, 'F'])[1]);
    st.fixes = new Map();
  };
  analyse();

  const canvas = h('canvas.img-canvas', { width: data.width, height: data.height, 'aria-label': `Image ${file.name} : clique-glisse pour encadrer la grille` });
  const ctx = canvas.getContext('2d');
  const paint = (r = st.rect) => {
    ctx.putImageData(data, 0, 0);
    ctx.lineWidth = Math.max(2, data.width / 400);
    ctx.strokeStyle = '#ffcc00';
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.lineWidth = Math.max(1, data.width / 900);
    ctx.strokeStyle = 'rgba(255, 204, 0, .55)';
    ctx.beginPath();
    for (let k = 1; k < 13; k++) {
      const x = r.x0 + ((r.x1 - r.x0) * k) / 13, y = r.y0 + ((r.y1 - r.y0) * k) / 13;
      ctx.moveTo(x, r.y0); ctx.lineTo(x, r.y1); ctx.moveTo(r.x0, y); ctx.lineTo(r.x1, y);
    }
    ctx.stroke();
  };
  let dragFrom = null;
  const at = (e) => { const b = canvas.getBoundingClientRect(); return [(e.clientX - b.left) * (canvas.width / b.width), (e.clientY - b.top) * (canvas.height / b.height)]; };
  const box = (a, b) => ({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
  canvas.addEventListener('pointerdown', (e) => { dragFrom = at(e); try { canvas.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ } });
  canvas.addEventListener('pointermove', (e) => { if (dragFrom) paint(box(dragFrom, at(e))); });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragFrom) return;
    const r = box(dragFrom, at(e));
    dragFrom = null;
    if (r.x1 - r.x0 > 26 && r.y1 - r.y0 > 26) { st.rect = r; analyse(); }
    draw();
  });

  const el = h('section.img-editor', { 'aria-label': `Lecture de ${file.name}` });
  const grid = () => gridFrom(st.type, read.of, codes, st.fixes);
  function draw() {
    paint();
    const seats = st.type === 'open' ? OPEN_SEATS : BB_VS;
    const actions = st.type === 'open' ? OPEN_ACTIONS : BB_ACTIONS;
    const chart = { type: st.type, seat: st.seat, stack: st.stack, grid: grid() };
    const ready = st.seat && st.stack;
    const sel = (label, value, opts, set) => h('label.pick-field', label, h('select', { 'aria-label': label, on: { change: (e) => { set(e.target.value); draw(); } } },
      value == null ? h('option', { value: '', selected: true }, 'à choisir') : null,
      opts.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l))));
    mount(el,
      h('div.row.between', h('strong', file.name), h('button.icon-btn.sm', { type: 'button', 'aria-label': `Fermer ${file.name}`, on: { click: onClose } }, '✕')),
      h('div.img-wrap', canvas),
      h('p.small.muted', 'Le cadre jaune doit entourer exactement les 13 × 13 cases (de AA à 22). Sinon, clique-glisse sur l\'image pour le redessiner.'),
      h('div.row.gap.wrap',
        sel('Chart', st.type, [['open', 'Open (first in)'], ['bb', 'BB']], (v) => { userSpot = true; st.type = v; st.seat = null; touched = false; guess(); st.fixes = new Map(); }),
        sel('Position', st.seat, seats.map((s) => [s, SPOT_NAMES[st.type][s]]), (v) => { userSpot = true; st.seat = v || null; if (!touched) guess(); }),
        sel('Stack', st.stack, STACKS.slice().sort((a, b) => b - a).map((s) => [s, s + 'bb']), (v) => { userSpot = true; st.stack = v ? +v : null; })),
      ocrNote(st.ocr),
      h('div.panel-title', 'Couleurs trouvées'),
      h('ul.color-list', read.clusters.map((c, i) => h('li',
        h('span.color-swatch', { style: { background: `rgb(${c.rgb.join(',')})` } }),
        h('select', { 'aria-label': `Action de la couleur ${i + 1}`, on: { change: (e) => { codes[i] = e.target.value; touched = true; st.fixes = new Map(); draw(); } } },
          actions.map(([v, l]) => h('option', { value: v, selected: v === codes[i] }, l))),
        h('span.small.muted', `${c.count} demi-cases`)))),
      h('div.img-result',
        MiniChart(chart, (idx) => {
          const all = CELL_CODES[st.type], cur = chart.grid[Math.floor(idx / 13)][idx % 13];
          st.fixes.set(idx, all[(all.indexOf(cur) + 1) % all.length]);
          draw();
        }),
        h('div.small.muted', 'Aperçu. Clique une case pour changer son code (R raise, A all-in, F fold… voir le modèle). Une case à deux couleurs devient une case mixte.',
          st.fixes.size ? h('div', `${st.fixes.size} case(s) corrigée(s) à la main.`) : null)),
      h('div.row.end', h('button.btn.primary', {
        type: 'button', disabled: !ready, title: ready ? null : 'Choisis la position et le stack',
        on: { click: () => onAdd(chart) },
      }, ready ? `Ajouter ${chartLabel(chart)}` : 'Choisis la position et le stack')));
  }
  draw();

  // Read the spot written on the image (its title). What the image says wins
  // over the file name, but never over a menu the user already changed.
  readText(data, st.rect).then((text) => {
    const found = spotFromText(text);
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => /[a-z0-9]{2}/i.test(l));
    const line = lines.find((l) => /\d\s*bb|open|rfi|vs/i.test(l)) || lines[0] || '';
    st.ocr = { status: found.seat || found.stack ? 'done' : 'none', line: line.slice(0, 60), found };
    if (!userSpot) {
      if (found.type && found.type !== st.type) { st.type = found.type; st.seat = null; if (!touched) guess(); st.fixes = new Map(); }
      if (found.seat && (found.type || st.type) === st.type && (st.type === 'open' ? OPEN_SEATS : BB_VS).includes(found.seat)) st.seat = found.seat;
      if (STACKS.includes(found.stack)) st.stack = found.stack;
      if (!touched) guess();
    }
    draw();
  }, (e) => { st.ocr = { status: 'error', line: e.message }; draw(); });
  return el;
}

// What the text reading found, under the menus.
function ocrNote(o) {
  if (!o) return h('p.small.muted.ocr-note', h('span.spinner.sm'), ' Lecture du spot et du stack écrits sur l\'image…');
  if (o.status === 'error') return h('p.small.muted.ocr-note', `Lecture du texte impossible (${o.line}) : choisis le spot et le stack.`);
  if (o.status === 'none') return h('p.small.muted.ocr-note', 'Aucun spot ni stack lisible sur l\'image', o.line ? ` (lu : « ${o.line} »)` : '', ' : choisis-les.');
  const f = o.found;
  const parts = [f.seat ? SPOT_NAMES[f.type || 'open']?.[f.seat] || f.seat : f.type === 'bb' ? 'BB' : f.type === 'open' ? 'Open' : null, f.stack && f.stack + 'bb'].filter(Boolean);
  return h('p.small.ocr-note', '✓ Lu sur l\'image : ', h('strong', `« ${o.line} »`), ` → ${parts.join(' · ')}`,
    f.stack && !STACKS.includes(f.stack) ? h('span.muted', ` (${f.stack}bb n'est pas un stack de l'appli : choisis le plus proche)`) : null);
}

export function openChartImport(onChange) {
  let parsed = { charts: [], errors: [] };
  const editors = [];
  const body = h('div.chart-import');
  const dlg = modal('Importer des chartes', body);
  dlg.el.classList.add('wide');

  const addPending = (c) => {
    const v = validate(c);
    if (!v.ok) { toast(v.error); return false; }
    parsed.charts = [...parsed.charts.filter((o) => !(o.type === c.type && o.seat === c.seat && o.stack === c.stack)), c];
    return true;
  };

  async function readFiles(files) {
    parsed.errors = [];
    for (const f of files) {
      if (/\.pdf$/i.test(f.name)) { parsed.errors.push(`${f.name} : un PDF ne peut pas être lu. Fais une capture d'écran de la charte (.png ou .jpg)`); continue; }
      if (IMAGE_RE.test(f.name) || /^image\//.test(f.type)) {
        try {
          const img = await loadImage(f);
          const ed = ImageEditor(f, img, {
            onAdd: (c) => { if (addPending(c)) { toast(`${chartLabel(c)} prêt à ajouter`); draw(); } },
            onClose: () => { editors.splice(editors.indexOf(ed), 1); draw(); },
          });
          editors.push(ed);
        } catch { parsed.errors.push(`${f.name} : image illisible`); }
        continue;
      }
      const r = parseChartText(await f.text(), f.name);
      r.charts.forEach(addPending); parsed.errors.push(...r.errors);
      if (!r.charts.length && !r.errors.length) parsed.errors.push(`${f.name} : aucun chart trouvé`);
    }
    draw();
  }

  const fileInput = h('input', { type: 'file', multiple: true, accept: '.txt,.json,.csv,.png,.jpg,.jpeg,.webp,text/plain,application/json,image/*', hidden: true, 'aria-label': 'Fichiers de chartes', on: { change: (e) => { readFiles(e.target.files); e.target.value = ''; } } });
  const drop = h('div.dropzone', {
    role: 'button', tabindex: '0',
    on: {
      click: () => fileInput.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
      dragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      dragleave: () => drop.classList.remove('over'),
      drop: (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); },
    },
  }, h('strong', 'Choisir un ou plusieurs fichiers'), h('span.small.muted', 'ou les glisser ici · captures .png / .jpg, ou fichiers .txt / .json'));
  function draw() {
    const mine = getUserCharts();
    mount(body,
      h('p.small.muted', 'Tes chartes importées remplacent celles d\'origine au même stack et à la même position. Elles servent partout : Étude, Entraînement, Leakfinder.'),
      drop, fileInput,
      h('div.row.gap.wrap',
        h('button.btn.ghost.sm', { type: 'button', on: { click: () => download('modele-chartes-raisemypoker.txt', TEMPLATE, 'text/plain') } }, 'Télécharger le modèle')),
      editors,
      parsed.errors.length ? h('ul.import-errors', { role: 'alert' }, parsed.errors.map((e) => h('li.small', e))) : null,
      parsed.charts.length ? h('section.import-preview',
        h('div.panel-title', `${parsed.charts.length} chart${parsed.charts.length > 1 ? 's' : ''} prêt${parsed.charts.length > 1 ? 's' : ''} à ajouter`),
        h('div.mini-charts', parsed.charts.map((c) => h('figure.mini-fig', MiniChart(c), h('figcaption.small', chartLabel(c),
          mine.some((o) => o.type === c.type && o.seat === c.seat && o.stack === c.stack) ? h('span.muted', ' (remplace)') : null)))),
        h('div.row.end', h('button.btn.primary', {
          type: 'button',
          on: { click: () => { addUserCharts(parsed.charts); toast(`${parsed.charts.length} chart${parsed.charts.length > 1 ? 's' : ''} ajouté${parsed.charts.length > 1 ? 's' : ''} au solver`); parsed = { charts: [], errors: [] }; onChange?.(); draw(); } },
        }, 'Ajouter au solver'))) : null,
      missingSpots(),
      h('section.import-mine',
        h('div.panel-title.row.between', h('span', `Mes chartes importées (${mine.length})`),
          mine.length ? h('span.row.gap',
            h('button.btn.ghost.sm', { type: 'button', on: { click: () => download('mes-chartes-raisemypoker.json', exportJson(), 'application/json') } }, 'Exporter'),
            h('button.btn.ghost.sm', { type: 'button', on: { click: () => { if (confirm('Supprimer toutes tes chartes importées ?')) { clearUserCharts(); onChange?.(); draw(); } } } }, 'Tout supprimer')) : null),
        mine.length
          ? h('ul.mine-list', mine.slice().sort((a, b) => a.type.localeCompare(b.type) || b.stack - a.stack || a.seat.localeCompare(b.seat)).map((c) => h('li.row.between',
            h('span', chartLabel(c)),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Supprimer ${chartLabel(c)}`, title: 'Supprimer', on: { click: () => { removeUserChart(c); onChange?.(); draw(); } } }, '✕'))))
          : h('p.small.muted', 'Aucune pour l\'instant.')));
  }
  draw();
  return dlg;
}
