// Study's "Importer des chartes" dialog.
// An import list: every file dropped (screenshots .png/.jpg, or .txt/.json)
// becomes one row. Screenshots are read one after the other in the
// background (grid, colors, spot, stack, legend), so ten images at once stay
// light; each row says if its chart is ready or what to check, and only the
// row being checked opens the image editor. "Ajouter" puts the ready charts
// in the solver. The list and the solver are separate: removing a row (or
// emptying the list) never takes a chart out of the solver; only "Retirer du
// solver" does. Below, the 6-max spots by stack: missing ones, and the ones
// you added (green).
import { h, mount, modal, toast } from './dom.js';
import { CLASSES } from '../engine/cards.js';
import {
  parseChartText, addUserCharts, getUserCharts, removeUserChart, clearUserCharts, chartLabel, TEMPLATE, exportJson, OPEN_SEATS, BB_VS, guessSpot, spotFromText, validate, onUserCharts,
} from '../data/user-charts.js';
import {
  detectGrid, sampleCells, clusterColors, guessCode, gridFrom, imageDataOf, OPEN_ACTIONS, BB_ACTIONS, CELL_CODES, legendEntries, legendType, legendCodes,
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

// A cell's color for a code (a mixed code is half one color, half the other).
function cellBg(type, code) {
  const colors = type === 'open' ? OPEN_COLORS : BB_COLORS;
  const half = HALF[type][code];
  return half ? `linear-gradient(90deg, ${colors[half[0]]} 50%, ${colors[half[1]]} 50%)` : colors[code];
}
// Every code a cell can take, with its name: the brush's palette.
const CODE_NAMES = {
  open: { R: 'Raise', A: 'All-in', M: 'Limp', F: 'Fold', L: 'Loosifie', T: 'Tightfie', X: 'Raise / Tightfie', H: 'Raise / Limp', a: 'All-in / Limp', m: 'Limp / Fold' },
  bb: { R: '3bet / raise', A: 'All-in', C: 'Call', K: 'Check', F: 'Fold', B: '3bet light', r: 'Raise / Call', c: 'Call / Fold', a: 'All-in / Call', j: 'All-in / Raise', n: 'Hors range' },
};

// A small 13x13 picture of a chart, colored by its codes. With a brush, it
// is painted: press on a cell and drag over others, each cell under the
// pointer takes the brush's code (mouse, pen or finger). brush: { code(),
// start(), paint(idx), end() }.
function MiniChart(c, brush, cls = '') {
  if (!brush) {
    return h('div.mini-chart' + cls, { role: 'img', 'aria-label': c.seat && c.stack ? chartLabel(c) : 'Aperçu' },
      CLASSES.map((k) => h('span', { style: { background: cellBg(c.type, c.grid[k.row][k.col]) } })));
  }
  const label = (k, code) => `${k.name} : ${CODE_NAMES[c.type][code] || code}`;
  const grid = h('div.mini-chart.edit' + cls, { role: 'group', 'aria-label': 'Charte à corriger : choisis une action, puis clique ou glisse sur les cases' },
    CLASSES.map((k) => {
      const code = c.grid[k.row][k.col];
      return h('button', {
        type: 'button', 'data-idx': k.id, title: label(k, code), 'aria-label': label(k, code), style: { background: cellBg(c.type, code) },
        // Keyboard (Enter / Space on a focused cell): one cell at a time.
        on: { click: (e) => { if (e.detail === 0) { brush.start(); paintEl(e.currentTarget); brush.end(); } } },
      }, h('span.mini-lbl', k.name));
    }));
  function paintEl(el) {
    const idx = +el.dataset.idx;
    brush.paint(idx);
    const code = brush.code();
    el.style.background = cellBg(c.type, code);
    el.title = el.ariaLabel = label(CLASSES[idx], code);
    el.setAttribute('aria-label', label(CLASSES[idx], code));
  }
  let down = false, last = null;
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest?.('button[data-idx]');
    if (el && grid.contains(el)) paintEl(el);
  };
  // A fast swipe reports few positions: every cell on the way between two
  // of them is painted too (steps of a third of a cell).
  const under = (e) => {
    const p = [e.clientX, e.clientY];
    if (last) {
      const step = Math.max(2, grid.getBoundingClientRect().width / 13 / 3);
      const n = Math.ceil(Math.hypot(p[0] - last[0], p[1] - last[1]) / step);
      for (let k = 1; k < n; k++) at(last[0] + ((p[0] - last[0]) * k) / n, last[1] + ((p[1] - last[1]) * k) / n);
    }
    at(p[0], p[1]);
    last = p;
  };
  grid.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    down = true;
    last = null;
    try { grid.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    brush.start();
    under(e);
  });
  grid.addEventListener('pointermove', (e) => { if (down) under(e); });
  const stop = () => { if (down) { down = false; brush.end(); } };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);
  return grid;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SPOT_NAMES = {
  open: { LJ: 'Open LJ', HJ: 'Open HJ', CO: 'Open CO', BTN: 'Open BTN', SB: 'Open SB' },
  bb: { LJ: 'BB vs open LJ', HJ: 'BB vs open HJ', CO: 'BB vs open CO', BTN: 'BB vs open BTN', SB: 'BB vs open SB', vsLimp: 'BB vs limp SB', vsLimp3bet: 'BB vs limp-relance SB', vsLimpShove: 'BB vs limp-tapis SB' },
};
const spotName = (c) => (c.seat ? SPOT_NAMES[c.type][c.seat] : c.type === 'bb' ? 'BB · position ?' : 'Open · position ?') + ' · ' + (c.stack ? c.stack + 'bb' : 'stack ?');
const slot = (c) => `${c.type}|${c.seat}|${c.stack}`;

// ---------- the 6-max spots by stack ----------
// Grey: no chart at all. Green: a chart you added to the solver.
const COVER_STACKS = [100, 50, 25, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
function spotsByStack() {
  const mine = new Set(getUserCharts().map(slot));
  let missing = 0;
  // The usual stacks, plus any stack you added a chart at (30bb, 40bb…).
  const stacks = [...new Set([...COVER_STACKS, ...getUserCharts().map((c) => c.stack)])].sort((a, b) => b - a);
  const rows = stacks.map((stack) => {
    const spots = [...OPEN_SEATS.map((s) => ['open', s]), ...BB_VS.map((s) => ['bb', s])];
    const added = spots.filter(([t, s]) => mine.has(`${t}|${s}|${stack}`));
    const miss = spots.filter(([t, s]) => !hasChart(t, s, stack));
    missing += miss.length;
    return h('li.miss-row',
      h('strong.mono', stack + 'bb'),
      added.length || miss.length
        ? h('span.miss-spots',
          added.map(([t, s]) => h('span.miss-tag.added', { title: 'Charte ajoutée dans le solver' }, '✓ ', SPOT_NAMES[t][s])),
          miss.map(([t, s]) => h('span.miss-tag' + (t === 'bb' ? '.bb' : ''), { title: 'Pas de charte' }, SPOT_NAMES[t][s])))
        : h('span.small.muted', 'toutes les chartes d\'origine sont là'));
  });
  return h('section.import-missing',
    h('div.panel-title', `Spots 6-max · ${missing} sans charte · ${mine.size} ajouté${mine.size > 1 ? 's' : ''} par toi`),
    h('p.small.muted', h('span.miss-tag.added', '✓ en vert'), ' : ta charte est dans le solver. ', h('span.miss-tag', 'en gris'), ' : pas de charte (le solver joue l\'équilibre tapis / fold à 15bb et moins, la charte la plus proche, ou son modèle).'),
    h('ul.miss-list', rows));
}

// ---------- reading a screenshot ----------
const IMAGE_RE = /\.(png|jpe?g|jfif|webp|gif|bmp)$/i;
const loadImage = (file) => new Promise((ok, ko) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { ok(img); URL.revokeObjectURL(url); };
  img.onerror = () => { ko(new Error('image illisible')); URL.revokeObjectURL(url); };
  img.src = url;
});

// Each color's action: from the chart's legend when it was read, else a
// guess from the hue (only the SB limps first in: elsewhere green is Loosifie).
function guess(st) {
  st.fromLegend = st.legend ? legendCodes(st.legend, st.read.clusters, st.type) : [];
  st.codes = st.read.clusters.map((c, i) => {
    if (st.fromLegend[i]) return st.fromLegend[i].code;
    const k = guessCode(c.rgb, st.type);
    return k === 'M' && st.seat && st.seat !== 'SB' ? 'L' : k;
  });
}

// What the text says (title: spot and stack; legend: each color's action).
function applyText(st, data, text, words) {
  const found = spotFromText(text);
  st.legend = legendEntries(data, words);
  if (!found.type) found.type = legendType(st.legend);
  // A stack the app doesn't have (22bb): the nearest one.
  if (found.stack && !STACKS.includes(found.stack)) found.near = STACKS.reduce((b, s) => (Math.abs(s - found.stack) < Math.abs(b - found.stack) ? s : b));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => /[a-z0-9]{2}/i.test(l));
  const line = lines.find((l) => spotFromText(l).seat && spotFromText(l).stack) || lines.find((l) => spotFromText(l).seat) || lines.find((l) => /\d\s*bb|open|rfi|vs/i.test(l)) || lines[0] || '';
  st.ocr = { status: found.seat || found.stack ? 'done' : 'none', line: line.slice(0, 60), found };
  if (found.type && found.type !== st.type) { st.type = found.type; st.seat = null; }
  if (found.seat && (st.type === 'open' ? OPEN_SEATS : BB_VS).includes(found.seat)) st.seat = found.seat;
  if (found.stack) st.stack = found.near || found.stack;
}

// Everything read automatically from one screenshot: the state its editor
// starts from. The image itself is not kept (the editor reloads it).
async function autoRead(file) {
  const data = imageDataOf(await loadImage(file));
  const spot = guessSpot(file.name);
  const rect = detectGrid(data);
  const st = {
    type: spot.type || 'open', seat: spot.seat, stack: STACKS.includes(spot.stack) ? spot.stack : null,
    rect, read: clusterColors(sampleCells(data, rect)), legend: null, ocr: null, fixes: new Map(), touched: false,
  };
  try { const { text, words } = await readText(data, rect); applyText(st, data, text, words); }
  catch (e) { st.ocr = { status: 'error', line: e.message }; }
  guess(st);
  if (st.ocr) st.ocr.legend = st.fromLegend.filter(Boolean).length;
  return st;
}

const chartOf = (st) => ({ type: st.type, seat: st.seat, stack: st.stack, grid: gridFrom(st.type, st.read.of, st.codes, st.fixes) });

// What is left to check on an automatic reading (empty: ready).
function problemsOf(st, checked) {
  if (checked) return [];
  const p = [];
  if (st.ocr?.status === 'error') p.push('texte illisible');
  if (!st.seat) p.push('position non lue');
  if (!st.stack) p.push('stack non lu');
  const guessed = st.touched ? 0 : st.codes.filter((c, i) => !st.fromLegend[i]).length;
  if (guessed) p.push(`${guessed} couleur${guessed > 1 ? 's' : ''} devinée${guessed > 1 ? 's' : ''}`);
  return p;
}

// ---------- the import list (kept while the page is open) ----------
let nextId = 1;
const list = [];
const listeners = new Set();
const changed = () => { for (const f of listeners) f(); };
let pumping = false;

function addFiles(files) {
  for (const f of files) {
    if (/\.pdf$/i.test(f.name)) { list.push({ id: nextId++, name: f.name, status: 'error', error: 'un PDF ne peut pas être lu : fais une capture d\'écran de la charte (.png ou .jpg)' }); continue; }
    if (IMAGE_RE.test(f.name) || /^image\//.test(f.type)) { list.push({ id: nextId++, name: f.name, file: f, kind: 'image', status: 'waiting' }); continue; }
    list.push({ id: nextId++, name: f.name, file: f, kind: 'text', status: 'waiting' });
  }
  changed();
  pump();
}

// Reads the waiting files one at a time (the text reader handles one image
// at a time anyway; this keeps memory low and the list responsive).
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (let it = list.find((x) => x.status === 'waiting'); it; it = list.find((x) => x.status === 'waiting')) {
      it.status = 'reading';
      changed();
      if (it.kind === 'text') {
        const r = parseChartText(await it.file.text(), it.name);
        const at = list.indexOf(it);
        const rows = r.charts.map((c) => ({ id: nextId++, name: it.name, kind: 'chart', status: 'ready', chart: c }));
        const errs = r.errors.map((e) => ({ id: nextId++, name: it.name, status: 'error', error: e }));
        if (!rows.length && !errs.length) errs.push({ id: nextId++, name: it.name, status: 'error', error: 'aucune charte trouvée' });
        if (at >= 0) list.splice(at, 1, ...rows, ...errs);
      } else {
        try {
          it.st = await autoRead(it.file);
          it.chart = chartOf(it.st);
          it.problems = problemsOf(it.st);
          it.status = it.problems.length ? 'check' : 'ready';
        } catch (e) { it.status = 'error'; it.error = e.message || 'image illisible'; }
      }
      changed();
    }
  } finally { pumping = false; }
}

// ---------- the editor of one screenshot ----------
// Starts from what was read automatically; "Valider" saves the changes into
// the row (it is then ready). Drag on the image to redraw the grid's frame.
function ImageEditor(it, { onDone, onClose }) {
  const el = h('section.img-editor', { 'aria-label': `Vérification de ${it.name}` }, h('div.row.gap', h('span.spinner.sm'), ' Ouverture de l\'image…'));
  loadImage(it.file).then((img) => build(imageDataOf(img)), () => mount(el, h('p.warn', 'Image illisible.')));
  function build(data) {
    const st = { ...it.st, codes: it.st.codes.slice(), fixes: new Map(it.st.fixes), fromLegend: it.st.fromLegend.slice() };
    if (!CELL_CODES[st.type].includes(st.brush)) st.brush = 'R';
    // The brush: a stroke (press, drag, release) is one step for "Annuler".
    const history = [];
    let before = null;
    const brush = {
      code: () => st.brush,
      start: () => { before = new Map(st.fixes); },
      paint: (idx) => { st.fixes.set(idx, st.brush); },
      end: () => {
        const same = before.size === st.fixes.size && [...st.fixes].every(([k, v]) => before.get(k) === v);
        if (!same) history.push(before);
        before = null;
        draw();
      },
    };
    const analyse = () => {
      // A new frame: colors already named keep their action (nearest old color).
      const prev = st.read.clusters.map((c, i) => [c.rgb, st.codes[i]]);
      st.read = clusterColors(sampleCells(data, st.rect));
      if (!st.touched) guess(st);
      else st.codes = st.read.clusters.map((c) => prev.reduce((b, p) => { const d = Math.hypot(...p[0].map((v, k) => v - c.rgb[k])); return d < b[0] ? [d, p[1]] : b; }, [1e9, 'F'])[1]);
      st.fixes = new Map();
    };
    const canvas = h('canvas.img-canvas', { width: data.width, height: data.height, 'aria-label': `Image ${it.name} : clique-glisse pour encadrer la grille` });
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
    function draw() {
      paint();
      const seats = st.type === 'open' ? OPEN_SEATS : BB_VS;
      const actions = st.type === 'open' ? OPEN_ACTIONS : BB_ACTIONS;
      const chart = chartOf(st);
      const ready = st.seat && st.stack;
      const sel = (label, value, opts, set) => h('label.pick-field', label, h('select', { 'aria-label': label, on: { change: (e) => { set(e.target.value); draw(); } } },
        value == null ? h('option', { value: '', selected: true }, 'à choisir') : null,
        opts.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l))));
      mount(el,
        h('div.row.between', h('strong', `Vérifier · ${it.name}`), h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Fermer sans valider', title: 'Fermer sans valider', on: { click: onClose } }, '✕')),
        h('div.img-wrap', canvas),
        h('p.small.muted', 'Le cadre jaune doit entourer exactement les 13 × 13 cases (de AA à 22). Sinon, clique-glisse sur l\'image pour le redessiner.'),
        h('div.row.gap.wrap',
          sel('Chart', st.type, [['open', 'Open (first in)'], ['bb', 'BB']], (v) => { st.type = v; st.seat = null; st.touched = false; guess(st); st.fixes = new Map(); history.length = 0; if (!CELL_CODES[v].includes(st.brush)) st.brush = 'R'; }),
          sel('Position', st.seat, seats.map((s) => [s, SPOT_NAMES[st.type][s]]), (v) => { st.seat = v || null; if (!st.touched) guess(st); }),
          sel('Stack', st.stack, STACKS.slice().sort((a, b) => b - a).map((s) => [s, s + 'bb']), (v) => { st.stack = v ? +v : null; })),
        ocrNote(st.ocr),
        h('div.panel-title', 'Couleurs trouvées'),
        h('ul.color-list', st.read.clusters.map((c, i) => h('li',
          h('span.color-swatch', { style: { background: `rgb(${c.rgb.join(',')})` } }),
          h('select', { 'aria-label': `Action de la couleur ${i + 1}`, on: { change: (e) => { st.codes[i] = e.target.value; st.touched = true; draw(); } } },
            actions.map(([v, l]) => h('option', { value: v, selected: v === st.codes[i] }, l))),
          h('span.small.muted', `${c.count} demi-cases`),
          !st.touched && st.fromLegend[i] ? h('span.small.pos', `· légende « ${st.fromLegend[i].word} »`) : !st.touched ? h('span.small.warn', '· deviné, à vérifier') : null))),
        h('div.img-result',
          MiniChart(chart, brush),
          h('div.brush-panel',
            h('div.panel-title', 'Pinceau'),
            h('p.small.muted', 'Choisis une action, puis clique ou glisse sur les cases de la charte : chaque case touchée la prend.'),
            h('div.brush-bar', { role: 'radiogroup', 'aria-label': 'Action du pinceau' }, CELL_CODES[st.type].split('').map((code) => h('button.brush-btn' + (code === st.brush ? '.on' : ''), {
              type: 'button', role: 'radio', 'aria-checked': code === st.brush ? 'true' : 'false',
              on: { click: () => { st.brush = code; draw(); } },
            }, h('span.brush-swatch', { style: { background: cellBg(st.type, code) } }), CODE_NAMES[st.type][code]))),
            h('div.row.gap.wrap',
              h('button.btn.ghost.sm', { type: 'button', disabled: !history.length, on: { click: () => { st.fixes = history.pop(); draw(); } } }, '↶ Annuler le dernier coup'),
              h('button.btn.ghost.sm', { type: 'button', disabled: !st.fixes.size, on: { click: () => { history.push(new Map(st.fixes)); st.fixes = new Map(); draw(); } } }, 'Effacer mes corrections')),
            st.fixes.size ? h('div.small.muted', `${st.fixes.size} case${st.fixes.size > 1 ? 's' : ''} corrigée${st.fixes.size > 1 ? 's' : ''} au pinceau.`) : null)),
        h('div.row.end.gap',
          h('button.btn.ghost', { type: 'button', on: { click: onClose } }, 'Annuler'),
          h('button.btn.primary', {
            type: 'button', disabled: !ready, title: ready ? null : 'Choisis la position et le stack',
            on: { click: () => { st.touched = true; onDone(st, chart); } },
          }, ready ? `Valider ${chartLabel(chart)}` : 'Choisis la position et le stack')));
    }
    draw();
  }
  return el;
}

// What the text reading found, in the editor.
function ocrNote(o) {
  if (!o) return null;
  if (o.status === 'error') return h('p.small.muted.ocr-note', `Lecture du texte impossible (${o.line}) : choisis le spot, le stack et l'action de chaque couleur.`);
  const legend = o.legend ? ` · légende : ${o.legend} couleur${o.legend > 1 ? 's' : ''} reconnue${o.legend > 1 ? 's' : ''}` : ' · pas de légende lisible : actions devinées d\'après les couleurs';
  if (o.status === 'none') return h('p.small.muted.ocr-note', 'Aucun spot ni stack lisible sur l\'image', o.line ? ` (lu : « ${o.line} »)` : '', ' : choisis-les', legend + '.');
  const f = o.found;
  const parts = [f.seat ? SPOT_NAMES[f.type || 'open']?.[f.seat] || f.seat : f.type === 'bb' ? 'BB' : f.type === 'open' ? 'Open' : null, f.stack && (f.near || f.stack) + 'bb'].filter(Boolean);
  return h('p.small.ocr-note', '✓ Lu sur l\'image : ', h('strong', `« ${o.line} »`), ` → ${parts.join(' · ')}`,
    f.near ? h('span.muted', ` (${f.stack}bb n'existe pas dans l'appli : ${f.near}bb, le plus proche)`) : null, legend);
}

// ---------- the dialog ----------
const STATUS = {
  waiting: ['En attente', 'muted'], reading: ['Lecture…', 'muted'], ready: ['✓ Prête', 'pos'], check: ['À vérifier', 'warn'],
  error: ['Erreur', 'neg'], added: ['✓ Dans le solver', 'pos'],
};

export function openChartImport(onChange) {
  const listEl = h('div.import-list');
  const editorEl = h('div.import-editor'); // not redrawn with the list: keeps focus while the others are read
  const restEl = h('div.import-rest');
  let editing = null; // the row whose editor is open

  const fileInput = h('input', { type: 'file', multiple: true, accept: '.txt,.json,.csv,.png,.jpg,.jpeg,.webp,text/plain,application/json,image/*', hidden: true, 'aria-label': 'Fichiers de chartes', on: { change: (e) => { addFiles([...e.target.files]); e.target.value = ''; } } });
  const drop = h('div.dropzone', {
    role: 'button', tabindex: '0',
    on: {
      click: () => fileInput.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
      dragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      dragleave: () => drop.classList.remove('over'),
      drop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); },
    },
  }, h('strong', 'Choisir une ou plusieurs chartes'), h('span.small.muted', 'ou les glisser ici · captures .png / .jpg (autant que tu veux), ou fichiers .txt / .json'));

  const body = h('div.chart-import',
    h('p.small.muted', 'Les chartes ajoutées au solver remplacent celles d\'origine au même stack et à la même position. Elles servent partout : Étude, Entraînement, Leakfinder.'),
    drop, fileInput,
    h('div.row.gap.wrap', h('button.btn.ghost.sm', { type: 'button', on: { click: () => download('modele-chartes-raisemypoker.txt', TEMPLATE, 'text/plain') } }, 'Télécharger le modèle')),
    listEl, editorEl, restEl);
  const dlg = modal('Importer des chartes', body);
  dlg.el.classList.add('wide');

  const toSolver = (rows) => {
    const ok = rows.filter((r) => r.chart && validate(r.chart).ok);
    if (!ok.length) return;
    addUserCharts(ok.map((r) => r.chart));
    for (const r of ok) r.status = 'added';
    toast(`${ok.length} charte${ok.length > 1 ? 's' : ''} ajoutée${ok.length > 1 ? 's' : ''} au solver`);
    onChange?.();
    changed();
  };
  const openEditor = (it) => {
    editing = it;
    mount(editorEl, ImageEditor(it, {
      onDone: (st, chart) => { it.st = st; it.chart = chart; it.problems = []; it.status = 'ready'; closeEditor(); changed(); },
      onClose: () => closeEditor(),
    }));
    editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    changed();
  };
  const closeEditor = () => { editing = null; mount(editorEl); changed(); };
  const removeRow = (it) => { list.splice(list.indexOf(it), 1); if (editing === it) closeEditor(); changed(); };

  function drawList() {
    if (!list.length) { mount(listEl); return; }
    const done = list.filter((r) => !['waiting', 'reading'].includes(r.status)).length;
    const images = list.filter((r) => r.kind === 'image');
    const imgDone = images.filter((r) => !['waiting', 'reading'].includes(r.status)).length;
    const ready = list.filter((r) => r.status === 'ready');
    const count = {};
    for (const r of list) if (r.chart?.seat && r.chart?.stack && r.status !== 'added') count[slot(r.chart)] = (count[slot(r.chart)] || 0) + 1;
    mount(listEl,
      h('div.import-head',
        h('div.panel-title', `Liste d'import · ${list.length} fichier${list.length > 1 ? 's' : ''}`),
        imgDone < images.length
          ? h('div.import-progress', h('span.spinner.sm'), ` Lecture des images ${imgDone + 1}/${images.length}…`, h('progress', { max: images.length, value: imgDone }))
          : null,
        h('div.row.gap.wrap',
          h('button.btn.primary.sm', { type: 'button', disabled: !ready.length, on: { click: () => toSolver(ready) } },
            ready.length ? `Ajouter ${ready.length} charte${ready.length > 1 ? 's' : ''} prête${ready.length > 1 ? 's' : ''} au solver` : 'Aucune charte prête'),
          h('button.btn.ghost.sm', { type: 'button', disabled: !done, on: { click: () => { list.splice(0, list.length, ...list.filter((r) => ['waiting', 'reading'].includes(r.status))); closeEditor(); changed(); } } }, 'Vider la liste'),
          h('span.small.muted', 'Vider la liste ne retire rien du solver.'))),
      h('ul.import-rows', list.map((it) => {
        const [label, tone] = STATUS[it.status];
        const dup = it.chart?.seat && count[slot(it.chart)] > 1;
        const canAdd = it.chart && it.chart.seat && it.chart.stack && it.status !== 'added';
        return h('li.import-row' + (editing === it ? '.editing' : '') + (it.status === 'added' ? '.added' : ''),
          it.chart ? MiniChart(it.chart, null, '.thumb') : h('div.thumb-empty', it.status === 'reading' ? h('span.spinner.sm') : '·'),
          h('div.import-info',
            h('div', h('strong', it.chart ? spotName(it.chart) : it.name), h('span.badge.' + tone, label)),
            h('div.small.muted', it.name),
            it.status === 'check' ? h('div.small.warn', 'À vérifier : ', it.problems.join(', ')) : null,
            it.status === 'error' ? h('div.small.neg', it.error) : null,
            dup ? h('div.small.warn', 'Même spot qu\'une autre ligne : la dernière ajoutée gagne.') : null,
            it.st?.ocr?.found?.near ? h('div.small.muted', `Stack ${it.st.ocr.found.stack}bb sur l'image → ${it.st.ocr.found.near}bb`) : null),
          h('div.import-actions',
            it.kind === 'image' && it.st ? h('button.btn.secondary.sm', { type: 'button', on: { click: () => (editing === it ? closeEditor() : openEditor(it)) } }, editing === it ? 'Fermer' : it.status === 'check' ? 'Vérifier' : 'Voir / modifier') : null,
            canAdd ? h('button.btn.secondary.sm', { type: 'button', title: it.status === 'check' ? 'Ajouter sans vérifier' : null, on: { click: () => toSolver([it]) } }, 'Ajouter') : null,
            ['waiting', 'reading'].includes(it.status) ? null : h('button.icon-btn.sm', { type: 'button', 'aria-label': `Retirer ${it.name} de la liste`, title: 'Retirer de la liste (ne touche pas au solver)', on: { click: () => removeRow(it) } }, '✕')));
      })));
  }

  function drawRest() {
    const mine = getUserCharts();
    mount(restEl,
      spotsByStack(),
      h('section.import-mine',
        h('div.panel-title.row.between', h('span', `Chartes dans le solver (${mine.length})`),
          mine.length ? h('span.row.gap',
            h('button.btn.ghost.sm', { type: 'button', on: { click: () => download('mes-chartes-raisemypoker.json', exportJson(), 'application/json') } }, 'Exporter'),
            h('button.btn.ghost.sm', { type: 'button', on: { click: () => { if (confirm(`Retirer du solver tes ${mine.length} chartes ? Le solver reviendra aux chartes d'origine.`)) { clearUserCharts(); onChange?.(); } } } }, 'Tout retirer du solver')) : null),
        mine.length
          ? h('ul.mine-list', mine.slice().sort((a, b) => a.type.localeCompare(b.type) || b.stack - a.stack || a.seat.localeCompare(b.seat)).map((c) => h('li.row.between',
            h('span', h('span.pos', '✓ '), chartLabel(c)),
            h('button.btn.ghost.sm', { type: 'button', 'aria-label': `Retirer ${chartLabel(c)} du solver`, on: { click: () => { if (confirm(`Retirer ${chartLabel(c)} du solver ?`)) { removeUserChart(c); onChange?.(); } } } }, 'Retirer du solver'))))
          : h('p.small.muted', 'Aucune pour l\'instant. Tes chartes ajoutées restent dans le solver, même après avoir vidé la liste d\'import ou fermé l\'appli.')));
  }

  const redraw = () => {
    if (!body.isConnected) { listeners.delete(redraw); return; }
    drawList();
  };
  let stopRest = null;
  const redrawRest = () => { if (body.isConnected) drawRest(); else stopRest?.(); };
  listeners.add(redraw);
  stopRest = onUserCharts(redrawRest);
  drawList();
  drawRest();
  return dlg;
}
