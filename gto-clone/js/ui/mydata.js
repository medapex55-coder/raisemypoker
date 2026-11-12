import { h, mount, num, toast } from './dom.js';
import { StatTile } from './components.js';
import { WinningsChart } from './chart.js';
import {
  importFiles, getTournaments, getHandRecords, setType, removeTournament, clearAll, getScreenNames, setScreenNames, staleCount,
} from '../data/datastore.js';
import { results, runZone, reliability, hudTotals } from '../data/handstats.js';
import { prepareSpots, sessionReview, spotTitle } from '../data/leaks.js';
import { spotTarget, trainingDecisions } from '../data/program.js';
import { startProgram } from './practice.js';
import { playSessions, abi, SESSION_HOURS } from '../data/playsessions.js';
import { recordImport } from '../data/progress.js';
import { celebrate } from './gamify.js';
import { exportBackup, importBackup } from '../data/backup.js';
import { getGateway } from '../data/datastore.js';
import { gatewaySupported, savedFolder, pickFolder, forgetFolder, hasAccess, syncFolder, onGatewaySync } from '../data/gateway.js';

const TYPES = { vanilla: 'Vanilla', ko: 'KO', mystery: 'Mystery KO' };
const filter = { type: 'all', room: 'all' };
const eur = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') + ' €' : '–');
const signed = (x) => (x > 0 ? '+' : '') + eur(x);
const sgn = (x, d = 1) => (x > 0 ? '+' : '') + x.toFixed(d).replace('.', ',');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const fmtDate = (s) => new Date(s).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let root;
let lastReport = null;
let unsub = null;
export function renderMyData(el) {
  root = el;
  unsub?.();
  // The gateway may bring new files while this page is open.
  unsub = onGatewaySync((res) => { importBadges(res.report); if (root?.isConnected) { lastReport = res.report; toast(reportText(res.report, GATEWAYS[res.room].title)); render(); } });
  render();
}

// Badges for importing tournaments (and for one finished in the money).
function importBadges(rep) {
  const keys = new Set(rep.tournaments);
  const itm = getTournaments().some((t) => keys.has(t.key) && !t.running && (t.prize || 0) > 0);
  celebrate({ badges: recordImport({ tournaments: keys.size, itm }) });
}

function reportText(rep, from = '') {
  const parts = [];
  if (rep.ok) parts.push(`${plural(rep.ok, 'fichier importé', 'fichiers importés')} · ${plural(rep.newTournaments, 'nouveau tournoi', 'nouveaux tournois')} · ${plural(rep.newHands, 'nouvelle main', 'nouvelles mains')}`);
  if (rep.duplicates.length) parts.push(`${plural(rep.duplicates.length, 'fichier déjà importé ignoré', 'fichiers déjà importés ignorés')}`);
  if (!parts.length) parts.push('Aucun fichier lisible');
  if (!rep.saved) return 'Stockage plein : le navigateur n\'a pas pu tout enregistrer';
  return (from ? from + ' : ' : '') + parts.join(' · ');
}

async function readFiles(fileList) {
  const files = [];
  for (const f of fileList) {
    if (!/\.txt$/i.test(f.name)) continue;
    files.push({ name: f.webkitRelativePath || f.name, text: await f.text() });
  }
  if (!files.length) { toast('Choisis des fichiers .txt'); return; }
  const rep = importFiles(files);
  toast(reportText(rep));
  importBadges(rep);
  lastReport = rep;
  render();
}

// ---------- Room gateways (Winamax, PokerStars) ----------
const GATEWAYS = {
  winamax: {
    title: 'Passerelle Winamax', name: 'Winamax', script: 'spotwise-winamax-sync.ps1', dest: 'Documents\\Spotwise\\Winamax',
    where: () => ['Winamax enregistre tes mains et tes résumés de tournoi dans ', h('code', '%APPDATA%\\winamax\\documents\\accounts\\<ton pseudo>\\history'), '. Vérifie que l\'option d\'enregistrement des historiques est active dans le logiciel.'],
  },
  pokerstars: {
    title: 'Passerelle PokerStars', name: 'PokerStars', script: 'spotwise-pokerstars-sync.ps1', dest: 'Documents\\Spotwise\\PokerStars',
    where: () => ['PokerStars enregistre tes mains dans ', h('code', '%LOCALAPPDATA%\\PokerStars.FR\\HandHistory\\<ton pseudo>'), ' et tes résumés de tournoi dans ', h('code', '…\\TournSummary\\<ton pseudo>'), '. Dans le logiciel, active Paramètres → Historique de jeu → « Enregistrer mes historiques de mains » et « Enregistrer mes résumés de tournois ».'],
  },
};

function gatewayPanel(room) {
  const box = h('section.panel.gateway', h('div.panel-title', GATEWAYS[room].title), h('p.small.muted', 'Chargement…'));
  fillGateway(box, room);
  return box;
}

async function fillGateway(box, room) {
  const g = getGateway(room);
  const cfg = GATEWAYS[room];
  const help = h('details.help', h('summary', 'Comment ça marche ?'),
    h('ol.small',
      h('li', ...cfg.where()),
      h('li', 'Chrome et Edge refusent d\'ouvrir les dossiers AppData. Télécharge le ', h('a', { href: `tools/${cfg.script}`, download: '' }, 'script de copie'),
        ', puis lance-le une fois avec l\'option ', h('code', '-Install'), ' (clic droit → Exécuter avec PowerShell, ou ', h('code', `powershell -ExecutionPolicy Bypass -File ${cfg.script} -Install`), `). Il copie tes fichiers ${cfg.name} dans `, h('code', cfg.dest), ' toutes les 10 minutes.'),
      h('li', 'Ici, connecte ce dossier ', h('code', cfg.dest), ' une fois. Ensuite, le site le relit tout seul au démarrage et toutes les 2 minutes tant qu\'il est ouvert, et n\'importe que ce qui est nouveau.'),
      h('li', 'Rien n\'est envoyé sur Internet : les fichiers sont lus par ton navigateur, sur ton PC.')));
  if (!gatewaySupported()) {
    const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true, on: { change: (e) => readFiles(e.target.files) } });
    box.replaceChildren(h('div.panel-title', cfg.title),
      h('p.small', 'Ton navigateur ne permet pas de garder l\'accès à un dossier (c\'est possible avec Chrome ou Edge). Tu peux quand même importer tout un dossier d\'un coup : les fichiers déjà importés sont ignorés.'),
      h('div.row.gap', input, h('button.btn.secondary', { type: 'button', on: { click: () => input.click() } }, 'Importer un dossier')), help);
    return;
  }
  const dir = await savedFolder(room);
  const access = dir ? await hasAccess(dir) : false;
  const status = !dir ? 'Aucun dossier connecté.'
    : access ? `Connecté à « ${dir.name} » · synchro auto toutes les 2 minutes · dernière synchro : ${g.last ? fmtDate(g.last) : 'jamais'} · ${plural(Object.keys(g.seen || {}).length, 'fichier suivi', 'fichiers suivis')}`
      : `Dossier « ${dir.name} » connecté, mais ton navigateur demande de réautoriser l'accès.`;
  const sync = async (ask) => {
    try {
      const d = dir || await pickFolder(room);
      if (!(await hasAccess(d, true))) { toast('Accès refusé au dossier'); return; }
      const res = await syncFolder(d, room);
      lastReport = res.report || lastReport;
      if (res.report) importBadges(res.report);
      toast(res.report ? reportText(res.report, cfg.title) : `${cfg.title} : rien de nouveau (${plural(res.total, 'fichier', 'fichiers')} dans le dossier)`);
      render();
    } catch (e) { if (e?.name !== 'AbortError') toast('Impossible de lire ce dossier : ' + (e?.message || e)); }
  };
  box.replaceChildren(h('div.panel-title', cfg.title),
    h('p.small' + (dir && !access ? '.warn' : ''), status),
    h('div.row.gap.wrap',
      !dir ? h('button.btn.primary', { type: 'button', on: { click: () => sync() } }, 'Connecter un dossier') : null,
      dir && !access ? h('button.btn.primary', { type: 'button', on: { click: () => sync(true) } }, 'Autoriser et synchroniser') : null,
      dir && access ? h('button.btn.secondary', { type: 'button', on: { click: () => sync() } }, 'Synchroniser maintenant') : null,
      dir ? h('button.btn.ghost.sm', { type: 'button', on: { click: async () => { await pickFolder(room).catch(() => null); render(); } } }, 'Changer de dossier') : null,
      dir ? h('button.btn.ghost.sm', { type: 'button', on: { click: async () => { await forgetFolder(room); render(); } } }, 'Déconnecter') : null),
    help);
}

// Buy-ins, winnings, profit, ROI and ITM of a list of tournaments.
function money(list) {
  const done = list.filter((t) => !t.running);
  const cost = done.reduce((a, t) => a + (t.cost || 0), 0);
  const won = done.reduce((a, t) => a + (t.winnings || 0), 0);
  const itm = done.filter((t) => (t.prize || 0) > 0).length;
  return { done, cost, won, profit: won - cost, roi: cost ? (won - cost) / cost : NaN, itm: done.length ? itm / done.length : 0 };
}
const roiText = (m) => (Number.isFinite(m.roi) ? sgn(m.roi * 100) + ' %' : '–');

function render() {
  const all = getTournaments();
  const list = all.filter((t) => (filter.type === 'all' || t.type === filter.type) && (filter.room === 'all' || t.room === filter.room));
  const m = money(list);
  const rooms = [...new Set(all.map((t) => t.room))];
  const tids = new Set(list.map((t) => t.tid));
  const recs = getHandRecords().filter((r) => tids.has(r.t));
  const groups = playSessions(list, recs);
  const stale = staleCount();

  const input = h('input', { type: 'file', multiple: true, accept: '.txt', hidden: true, on: { change: (e) => readFiles(e.target.files) } });
  const drop = h('div.dropzone', {
    tabindex: '0', role: 'button', 'aria-label': 'Importer des fichiers de tournoi',
    on: {
      click: () => input.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      dragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      dragleave: () => drop.classList.remove('over'),
      drop: (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); },
    },
  }, input, h('strong', 'Dépose tes fichiers de tournoi ici, ou clique pour les choisir'),
  h('span.muted.small', 'Deux fichiers .txt par tournoi : le résumé et l\'historique des mains. Ils sont lus dans ton navigateur et n\'en sortent jamais. Tes tournois sont regroupés en sessions de jeu.'));

  mount(root, h('div.data-page',
    h('div.row.between', h('h1', 'Mes données'),
      all.length ? h('button.btn.ghost.sm', { type: 'button', on: { click: () => { if (confirm('Supprimer tous les tournois importés de ce navigateur ?')) { clearAll(); render(); } } } }, 'Tout supprimer') : null),
    drop,
    gatewayPanel('winamax'),
    gatewayPanel('pokerstars'),
    backupPanel(),
    stale ? h('div.panel.warn.stale-note', h('strong', 'Réimporte tes historiques de mains'), h('p.small', `Le calcul des gains, du run meter et des re-entries a été corrigé (mises non payées sur Winamax, re-entries lues dans les mains). ${plural(stale, 'tournoi a', 'tournois ont')} été importé${stale > 1 ? 's' : ''} avant : dépose à nouveau tes fichiers, ou synchronise ta passerelle (elle relit tout le dossier). Rien n'est compté deux fois.`)) : null,
    lastReport?.errors.length ? h('div.panel.warn', h('strong', 'Certains fichiers n\'ont pas été lus'), h('ul', lastReport.errors.slice(0, 8).map((e) => h('li.small', e)))) : null,
    h('details.help', h('summary', 'Règle anti-doublon'),
      h('ul.small',
        h('li', 'Un fichier déjà importé (même contenu) est ignoré.'),
        h('li', 'Un tournoi est reconnu par sa room et son numéro : le réimporter le met à jour, il n\'apparaît jamais deux fois.'),
        h('li', 'Une main est reconnue par son numéro : si elle est dans deux fichiers, elle n\'est comptée qu\'une fois.'),
        h('li', 'Retirer un tournoi permet de le réimporter ensuite.'))),
    h('details.help', h('summary', 'Où sont mes fichiers ?'),
      h('ul.small',
        h('li', h('strong', 'PokerStars : '), 'résumés dans %LOCALAPPDATA%\\PokerStars.FR\\TournSummary\\<ton pseudo>, mains dans …\\HandHistory\\<ton pseudo> (ou utilise la passerelle ci-dessus).'),
        h('li', h('strong', 'Winamax : '), '%APPDATA%\\winamax\\documents\\accounts\\<ton pseudo>\\history (ou utilise la passerelle ci-dessus).'),
        h('li', h('strong', 'PMU, Betclic : '), 'pas encore pris en charge. Envoie un tournoi (ses deux fichiers) et le format sera ajouté.'))),
    h('div.field.names', h('div.field-label', 'Mes pseudos'),
      h('input.text', {
        type: 'text', value: getScreenNames().join(', '), placeholder: 'ex. Goodrhum', 'aria-label': 'Mes pseudos',
        on: { change: (e) => { setScreenNames(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)); render(); } },
      })),
    all.length ? h('div.row.gap.wrap',
      h('label.pick-field', 'Type', h('select', { on: { change: (e) => { filter.type = e.target.value; render(); } } },
        [['all', 'Tous'], ...Object.entries(TYPES)].map(([v, l]) => h('option', { value: v, selected: filter.type === v }, l)))),
      rooms.length > 1 ? h('label.pick-field', 'Room', h('select', { on: { change: (e) => { filter.room = e.target.value; render(); } } },
        ['all', ...rooms].map((r) => h('option', { value: r, selected: filter.room === r }, r === 'all' ? 'Toutes' : r)))) : null) : null,
    all.length ? h('div.stats-row.wide',
      StatTile('Tournois', m.done.length, [entriesOf(list) > list.length ? `${entriesOf(list)} entrées avec les re-entries` : null, list.length > m.done.length ? `${list.length - m.done.length} en cours` : null].filter(Boolean).join(' · ') || null),
      StatTile('Total des buy-ins', eur(m.cost)),
      StatTile('ABI', eur(abi(list)), 'buy-in moyen'),
      StatTile('Total gagné', eur(m.won)),
      StatTile('Bénéfice', h('span', { class: m.profit >= 0 ? 'pos' : 'neg' }, signed(m.profit))),
      StatTile('ROI', roiText(m), `ITM ${Math.round(m.itm * 100)} %`)) : null,
    all.length ? runPanel(recs, groups[0]?.start != null ? new Set(groups[0].tours.map((t) => t.tid)) : null) : null,
    all.length ? sessionsView(groups, recs) : h('div.empty-state', h('p.muted', 'Aucun tournoi pour l\'instant. Importe tes fichiers pour voir tes résultats ici, puis ouvre Leakfinder.')),
  ));
}

// ---------- winrate, graph and run meter ----------
const ZONES = [
  { id: 'terrible', label: 'Run terrible', from: 0, to: 10 },
  { id: 'bad', label: 'Bad run', from: 10, to: 30 },
  { id: 'neutral', label: 'Run neutre', from: 30, to: 70 },
  { id: 'good', label: 'Good run', from: 70, to: 90 },
  { id: 'sun', label: 'Sun run', from: 90, to: 100 },
];
const REL = { verylow: ['Très faible', 'neg'], low: ['Faible', 'neg'], medium: ['Moyenne', 'warn'], good: ['Bonne', 'pos'], high: ['Élevée', 'pos'] };
// z-score -> position on the bar: -3..-2 terrible, -2..-1 bad, -1..1 neutral, 1..2 good, 2..3 sun.
function zPos(z) {
  const c = Math.max(-3, Math.min(3, z));
  const pts = [[-3, 0], [-2, 10], [-1, 30], [1, 70], [2, 90], [3, 100]];
  for (let i = 1; i < pts.length; i++) if (c <= pts[i][0]) return pts[i - 1][1] + (c - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]) * (pts[i][1] - pts[i - 1][1]);
  return 100;
}

export function runPanel(recs, lastTids = null) {
  if (!recs.length) {
    return h('section.panel', h('div.panel-title', 'Winrate et run meter'),
      h('p.muted.small', 'Importe aussi les historiques de mains de tes tournois pour voir ton winrate en bb/100, ta courbe de gains et ton run meter. Les tournois importés avant cette version doivent être réimportés.'));
  }
  const r = results(recs);
  // Compared with before the last play session.
  const prev = lastTids ? recs.filter((x) => !lastTids.has(x.t)) : [];
  const p = prev.length ? results(prev) : null;
  const stat = (value, label, color, key) => {
    const d = p ? value - p[key] : null;
    const isHands = key === 'hands';
    return h('div.wr-stat',
      h('div.big', h('span', { class: isHands ? '' : value >= 0 ? 'pos' : 'neg' }, isHands ? value : sgn(value)),
        d != null && !isHands ? h('span.delta' + (d > 0.05 ? '.up' : d < -0.05 ? '.down' : ''), { title: 'Écart par rapport à avant ta dernière session de jeu' }, (d > 0.05 ? '↑ ' : d < -0.05 ? '↓ ' : '') + sgn(d)) : null,
        d != null && isHands ? h('span.delta', { title: 'Mains jouées pendant ta dernière session de jeu' }, '+' + d) : null),
      h('div.wr-label', color ? h('span.dot', { style: { '--c': color } }) : null, label));
  };
  const zone = runZone(r.z);
  const [relText, relTone] = REL[reliability(r.hands)];
  const zoneLabel = ZONES.find((z) => z.id === zone).label;
  return h('section.panel.runpanel',
    h('div.wr-head',
      stat(r.hands, 'Mains', null, 'hands'),
      stat(r.bb100, 'Winrate bb/100', 'var(--series-net)', 'bb100'),
      stat(r.ev100, 'Winrate EV bb/100', 'var(--series-ev)', 'ev100'),
      stat(r.sd100, 'Showdown bb/100', 'var(--series-sd)', 'sd100'),
      stat(r.nsd100, 'Sans showdown bb/100', 'var(--series-nsd)', 'nsd100')),
    WinningsChart(r.curve),
    h('div.runmeter.panel',
      h('div.row.between.wrap',
        h('div.panel-title', { title: 'Compare tes gains réels à tes gains EV : quand tu es à tapis avant la river, on compte ta part d\'équité du pot au lieu du résultat réel. L\'écart, c\'est la chance.' }, 'Run meter ⓘ'),
        h('span.badge.' + relTone, `Fiabilité de l'échantillon : ${relText}`)),
      h('div.run-figures',
        h('div', h('div.big', { class: r.luck100 >= 0 ? 'pos' : 'neg' }, sgn(r.luck100)), h('div.small.muted', 'bb/100 par rapport à l\'EV')),
        h('div', h('div.big', { class: r.luck >= 0 ? 'pos' : 'neg' }, sgn(r.luck, 0)), h('div.small.muted', 'bb par rapport à l\'EV')),
        h('div', h('div.big.warn', Math.round(r.runBetter * 100) + ' %'), h('div.small.muted', 'des joueurs run mieux'))),
      h('div.run-bar', { role: 'img', 'aria-label': `Run meter : ${zoneLabel}` },
        ZONES.map((z) => h('span', { style: { width: z.to - z.from + '%' } })),
        h('span.run-marker', { style: { left: zPos(r.z) + '%' } })),
      h('div.run-labels', ZONES.map((z) => h('span', { style: { left: (z.from + z.to) / 2 + '%' } }, z.label))),
      h('div.run-verdict', { style: { color: `var(--run-${zone})` } }, zoneLabel),
      h('p.small.muted', `Calculé sur ${plural(r.hands, 'main', 'mains')}. En dessous de 1 000 mains, le résultat dépend surtout de la chance : ne tire pas de conclusion trop vite.`)));
}

// ---------- play sessions (10h windows) ----------
// A strip of sessions (date and result), and the chosen one in full: money,
// hands, winrate, luck, HUD, its preflop decisions graded with your current
// charts, the spots to work on, and its tournaments.
const hhmm = (x) => new Date(x).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayText = (x) => new Date(x).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const duration = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const entriesOf = (tours) => tours.reduce((a, t) => a + (t.entries || 1), 0);
let shownSession = null; // start time of the session on display

function sessionsView(groups, recs) {
  if (!groups.length) return null;
  const idOf = (g) => String(g.start ?? 'none');
  const cur = groups.find((g) => idOf(g) === shownSession) || groups[0];
  const strip = h('div.session-strip', { role: 'tablist', 'aria-label': 'Sessions de jeu' }, groups.map((g) => {
    const m = money(g.tours);
    const on = g === cur;
    return h('button.session-chip' + (on ? '.on' : ''), {
      type: 'button', role: 'tab', 'aria-selected': String(on),
      on: { click: () => { shownSession = idOf(g); render(); } },
    },
    h('span.small.muted', g.start ? dayText(g.start) : 'Date inconnue'),
    h('strong', { class: m.done.length ? (m.profit >= 0 ? 'pos' : 'neg') : '' }, m.done.length ? signed(m.profit) : 'en cours'),
    h('span.small.muted', plural(entriesOf(g.tours), 'entrée', 'entrées')));
  }));
  return h('section.sessions',
    h('h2', 'Sessions de jeu'),
    h('p.small.muted', `Une session commence à ton premier tournoi et regroupe tous ceux lancés dans les ${SESSION_HOURS} heures qui suivent. Choisis une session pour voir son détail.`),
    strip,
    sessionDetail(cur, recs));
}

function sessionDetail(g, allRecs) {
  const tids = new Set(g.tours.map((t) => t.tid));
  const recs = allRecs.filter((r) => tids.has(r.t));
  const m = money(g.tours);
  const r = results(recs);
  const hud = hudTotals(recs);
  const rate = (k) => (hud[k]?.opp ? Math.round((hud[k].hit / hud[k].opp) * 100) + ' %' : '–');
  const entries = entriesOf(g.tours);
  const re = entries - g.tours.length;
  const bounties = g.tours.reduce((a, t) => a + (t.bounties || 0), 0);
  const review = h('div.session-review', h('p.small.muted', 'Analyse de tes décisions préflop…'));
  fillReview(review, trainingDecisions().filter((d) => tids.has(d.t)));
  return h('div.panel.session-detail', { role: 'tabpanel' },
    h('div.row.between.wrap',
      h('div', h('strong', g.start ? `Session du ${dayText(g.start)}` : 'Tournois sans date'),
        g.start ? h('span.small.muted', ` · ${hhmm(g.start)} → ${hhmm(g.end)} (${duration(g.end - g.start)})`) : null),
      h('span.big-result', { class: m.profit >= 0 ? 'pos' : 'neg' }, m.done.length ? signed(m.profit) : '–')),
    h('div.stats-row.wide',
      StatTile('Tournois', g.tours.length, re ? `${plural(entries, 'entrée', 'entrées')} dont ${plural(re, 're-entry', 're-entries')}` : plural(entries, 'entrée', 'entrées')),
      StatTile('Buy-ins', eur(m.cost), `ABI ${eur(abi(g.tours))}`),
      StatTile('Gains', eur(m.won), bounties ? `dont ${eur(bounties)} de primes` : null),
      StatTile('ROI', roiText(m), `ITM ${Math.round(m.itm * 100)} %`),
      StatTile('Mains', recs.length || '–', recs.length ? `VPIP ${rate('VPIP')} · PFR ${rate('PFR')} · 3-bet ${rate('3B')}` : 'historique non importé')),
    recs.length ? h('div.stats-row.wide',
      StatTile('Winrate', h('span', { class: r.bb100 >= 0 ? 'pos' : 'neg' }, sgn(r.bb100) + ' bb/100')),
      StatTile('Winrate EV', h('span', { class: r.ev100 >= 0 ? 'pos' : 'neg' }, sgn(r.ev100) + ' bb/100')),
      StatTile('Chance', h('span', { class: r.luck >= 0 ? 'pos' : 'neg' }, sgn(r.luck, 0) + ' bb'), 'gains réels − gains EV'),
      StatTile('Showdown', sgn(r.sd100) + ' bb/100'),
      StatTile('Sans showdown', sgn(r.nsd100) + ' bb/100')) : null,
    recs.length > 1 ? WinningsChart(r.curve) : null,
    review,
    tourTable(g.tours));
}

// The session's preflop decisions graded with the charts you have today.
async function fillReview(box, decisions) {
  if (!decisions.length) { box.replaceChildren(h('p.small.muted', 'Aucune décision préflop : importe l\'historique des mains de ces tournois.')); return; }
  await prepareSpots(decisions);
  if (!box.isConnected) return;
  const { n, score, mistakes, toWork } = sessionReview(decisions);
  box.replaceChildren(
    h('div.panel-title', 'Tes décisions préflop'),
    h('p.small', n ? `${plural(n, 'décision notée', 'décisions notées')} avec tes chartes actuelles · score ${Math.round(score * 100)} % · ${plural(mistakes, 'erreur', 'erreurs')}` : 'Aucune décision notée sur ces spots.'),
    toWork.length ? h('ul.small.session-spots', toWork.map((sp) => h('li', h('strong', `${spotTitle(sp)} · ${sp.group}`), ` · ${plural(sp.mistakes, 'erreur', 'erreurs')} sur ${plural(sp.n, 'main', 'mains')}`))) : n ? h('p.small.muted', 'Rien à corriger sur cette session.') : null,
    toWork.length ? h('div.row.end', h('button.btn.primary.sm', {
      type: 'button', title: 'S\'entraîner sur ces spots, 10 mains chacun',
      on: { click: () => { startProgram({ slotId: null, spots: toWork.map(spotTarget), random: false }); location.hash = '#/practice'; } },
    }, 'Étudier ces spots')) : null);
}

function tourTable(list) {
  return h('div.table-wrap', h('table.data',
    h('thead', h('tr', h('th', 'Date'), h('th', 'Tournoi'), h('th', 'Type'), h('th', 'Buy-in'), h('th', 'Joueurs'), h('th', 'Prize pool'),
      h('th', 'Place'), h('th', 'Gains'), h('th', 'Bénéfice'), h('th', 'Fichiers'), h('th', ''))),
    h('tbody', list.map((t) => h('tr',
      h('td.mono', t.date ? t.date.split('-').reverse().join('/') : '–'),
      h('td', h('div', t.name), h('div.small.muted', `${t.room} #${t.tid}`)),
      h('td', h('select.inline', { 'aria-label': 'Type de tournoi', on: { change: (e) => { setType(t.key, e.target.value); render(); } } },
        Object.entries(TYPES).map(([v, l]) => h('option', { value: v, selected: t.type === v }, l)))),
      h('td.mono', eur(t.buyin), t.entries > 1 ? h('div.small.muted', `+${plural(t.entries - 1, 're-entry', 're-entries')} · total ${eur(t.cost)}`) : null),
      h('td.mono', t.players || '–'),
      h('td.mono', eur(t.prizePool)),
      h('td.mono', t.running ? 'en cours' : t.place ? `${t.place}${t.players ? ' / ' + t.players : ''}` : '–'),
      h('td.mono', eur(t.winnings), t.bounties ? h('div.small.muted', `dont ${eur(t.bounties)} de primes`) : null),
      h('td.mono', { class: t.running ? '' : t.profit >= 0 ? 'pos' : 'neg' }, t.running ? '–' : signed(t.profit)),
      h('td.small', ['summary', 'hands'].map((f) => h('span.file-tag' + (t.files.includes(f) ? '.on' : ''), { title: (f === 'summary' ? 'Résumé' : 'Mains') + (t.files.includes(f) ? ' importé' : ' manquant') }, f === 'summary' ? 'R' : 'M')),
        t.handsCount ? h('div.muted', plural(t.handsCount, 'main', 'mains')) : null),
      h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Retirer le tournoi', title: 'Retirer', on: { click: () => { removeTournament(t.key); render(); } } }, '✕')))))));
}

export const fmtEur = eur;
export { num };

// ---------- backup ----------
function backupPanel() {
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportBackup()], { type: 'application/json' }));
    const a = h('a', { href: url, download: `sauvegarde-poker-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restore = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !confirm('Remplacer toutes les données de ce navigateur par cette sauvegarde ?')) return;
    try { importBackup(await file.text()); location.reload(); } catch (err) { toast(err.message); }
  };
  return h('section.panel.backup', h('div.panel-title', 'Sauvegarde'),
    h('p.small.muted', 'Tes mains, sessions, XP et badges sont gardés dans ce navigateur, pour cette adresse du site. Exporte-les pour les retrouver sur une autre adresse ou un autre ordinateur. Les passerelles seront à reconnecter.'),
    h('div.row.gap.wrap',
      h('button.btn.secondary.sm', { type: 'button', on: { click: download } }, 'Exporter mes données'),
      h('label.btn.ghost.sm', 'Importer une sauvegarde', h('input', { type: 'file', accept: '.json', hidden: true, 'aria-label': 'Importer une sauvegarde', on: { change: restore } }))));
}
