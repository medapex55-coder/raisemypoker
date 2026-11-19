// Study's "Importer des chartes" dialog: files (.txt, .json, several at once),
// a preview of every chart read, then they join the solver. Below, the 6-max
// spots that still have no chart at each stack.
import { h, mount, modal, toast } from './dom.js';
import { CLASSES } from '../engine/cards.js';
import {
  parseChartText, addUserCharts, getUserCharts, removeUserChart, clearUserCharts, chartLabel, TEMPLATE, exportJson, OPEN_SEATS, BB_VS,
} from '../data/user-charts.js';
import { hasChart } from '../engine/strategy.js';

const OPEN_COLORS = { R: 'var(--act-bet-m)', A: 'var(--act-allin)', M: 'var(--act-call)', F: 'var(--act-fold)', L: 'var(--tag-loose)', T: 'var(--tag-tight)' };
const BB_COLORS = { R: 'var(--act-bet-m)', A: 'var(--act-allin)', C: 'var(--act-call)', K: 'var(--act-call)', F: 'var(--act-fold)', B: 'var(--tag-light)', n: 'transparent' };
const HALF = {
  open: { X: ['R', 'T'], H: ['R', 'M'], a: ['A', 'M'], m: ['M', 'F'] },
  bb: { r: ['R', 'C'], c: ['C', 'F'], a: ['A', 'C'], j: ['A', 'R'], q: ['C', 'C'] },
};

// A small 13x13 picture of a chart, colored by its codes.
function MiniChart(c) {
  const colors = c.type === 'open' ? OPEN_COLORS : BB_COLORS;
  return h('div.mini-chart', { role: 'img', 'aria-label': chartLabel(c) }, CLASSES.map((cls) => {
    const code = c.grid[cls.row][cls.col];
    const half = HALF[c.type][code];
    const bg = half ? `linear-gradient(90deg, ${colors[half[0]]} 50%, ${colors[half[1]]} 50%)` : colors[code];
    return h('span', { title: `${cls.name} : ${code}`, style: { background: bg } });
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

export function openChartImport(onChange) {
  let parsed = { charts: [], errors: [] };
  const body = h('div.chart-import');
  const dlg = modal('Importer des chartes', body);

  async function readFiles(files) {
    const next = { charts: [], errors: [] };
    for (const f of files) {
      if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(f.name)) { next.errors.push(`${f.name} : une image ou un PDF ne peut pas être lu, il faut le chart en texte (voir le modèle)`); continue; }
      const r = parseChartText(await f.text(), f.name);
      next.charts.push(...r.charts); next.errors.push(...r.errors);
      if (!r.charts.length && !r.errors.length) next.errors.push(`${f.name} : aucun chart trouvé`);
    }
    parsed = next; draw();
  }

  const fileInput = h('input', { type: 'file', multiple: true, accept: '.txt,.json,.csv,text/plain,application/json', hidden: true, 'aria-label': 'Fichiers de chartes', on: { change: (e) => { readFiles(e.target.files); e.target.value = ''; } } });
  const drop = h('div.dropzone', {
    role: 'button', tabindex: '0',
    on: {
      click: () => fileInput.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
      dragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      dragleave: () => drop.classList.remove('over'),
      drop: (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); },
    },
  }, h('strong', 'Choisir un ou plusieurs fichiers'), h('span.small.muted', 'ou les glisser ici · .txt ou .json, plusieurs chartes par fichier possible'));
  function draw() {
    const mine = getUserCharts();
    mount(body,
      h('p.small.muted', 'Tes chartes importées remplacent celles d\'origine au même stack et à la même position. Elles servent partout : Étude, Entraînement, Leakfinder.'),
      drop, fileInput,
      h('div.row.gap.wrap',
        h('button.btn.ghost.sm', { type: 'button', on: { click: () => download('modele-chartes-raisemypoker.txt', TEMPLATE, 'text/plain') } }, 'Télécharger le modèle')),
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
