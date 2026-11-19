// Charts the user imports from Study (files or pasted text), kept in
// localStorage. They take precedence over the built-in charts:
//   open charts (first in, LJ..SB) for an exact stack, or for a chart depth
//   (20, 25, 50, 100bb) where they replace the built-in chart and its blends;
//   BB charts vs an open (LJ..SB), vs the SB's limp, limp-reraise or limp-shove.
// Same 13x13 layout and codes as the built-in charts (charts-50.js, charts-short.js).
import { CLASS_BY_NAME, RANKS } from '../engine/cards.js';
import { STACKS } from '../engine/game.js';

const KEY = 'rmp.userCharts.v1';
export const OPEN_SEATS = ['LJ', 'HJ', 'CO', 'BTN', 'SB'];
export const BB_VS = ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'vsLimp', 'vsLimp3bet', 'vsLimpShove'];
export const OPEN_CODES = 'RFLTXMHAam';
export const BB_CODES_OK = 'FCRBKcrAajqn';
const BB_TITLES = { vsLimp: 'BB vs limp SB', vsLimp3bet: 'BB vs limp-relance SB', vsLimpShove: 'BB vs limp-tapis SB' };
const BB_RAISE = { vsLimp: 'Raise', vsLimp3bet: 'Tapis', vsLimpShove: 'Tapis' };

let charts = load();
const listeners = new Set();

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((c) => validate(c).ok) : [];
  } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(charts)); } catch { /* storage full or blocked */ }
  for (const f of listeners) f();
}

export const onUserCharts = (f) => listeners.add(f);
export const getUserCharts = () => charts.slice();
export const chartLabel = (c) => (c.type === 'open' ? `Open ${c.seat}` : BB_TITLES[c.seat] || `BB vs open ${c.seat}`) + ` · ${c.stack}bb`;
const sameSlot = (a, b) => a.type === b.type && a.seat === b.seat && a.stack === b.stack;

// Adds charts; one that has the same type, seat and stack replaces the old one.
export function addUserCharts(list) {
  for (const c of list) charts = [...charts.filter((o) => !sameSlot(o, c)), c];
  save();
}
export function removeUserChart(c) { charts = charts.filter((o) => !sameSlot(o, c)); save(); }
export function clearUserCharts() { charts = []; save(); }

// Lookups used by the strategy engine.
export function userOpenChart(seat, stack) {
  return charts.find((c) => c.type === 'open' && c.seat === seat && c.stack === stack)?.grid || null;
}
// { vsLimp: chart, CO: chart, ... } at one stack, in the built-in BB charts' shape.
export function userBbCharts(stack) {
  const out = {};
  for (const c of charts) {
    if (c.type !== 'bb' || c.stack !== stack) continue;
    out[c.seat] = { title: (BB_TITLES[c.seat] || `BB vs open ${c.seat}`) + ' (importé)', raiseLabel: BB_RAISE[c.seat] || '3bet', grid: c.grid, user: true };
  }
  return Object.keys(out).length ? out : null;
}
export const isUserOpen = (seat, stack) => !!userOpenChart(seat, stack);

// ---------- validation ----------
export function validate(c) {
  if (!c || (c.type !== 'open' && c.type !== 'bb')) return { ok: false, error: 'type inconnu (open ou bb)' };
  const seats = c.type === 'open' ? OPEN_SEATS : BB_VS;
  if (!seats.includes(c.seat)) return { ok: false, error: `position « ${c.seat ?? '?'} » inconnue (${seats.join(', ')})` };
  if (!STACKS.includes(c.stack)) return { ok: false, error: `stack ${c.stack ?? '?'}bb non disponible (${STACKS.slice().sort((a, b) => a - b).join(', ')})` };
  const codes = c.type === 'open' ? OPEN_CODES : BB_CODES_OK;
  if (!Array.isArray(c.grid) || c.grid.length !== 13 || c.grid.some((r) => typeof r !== 'string' || r.length !== 13)) return { ok: false, error: 'la grille doit faire 13 lignes de 13 cases' };
  const bad = [...new Set(c.grid.join('').split('').filter((x) => !codes.includes(x)))];
  if (bad.length) return { ok: false, error: `code(s) ${bad.join(' ')} inconnu(s) pour un chart ${c.type === 'open' ? 'd\'open' : 'BB'} (${codes.split('').join(' ')})` };
  return { ok: true };
}

// ---------- parsing ----------
// A file or pasted text -> { charts, errors }. Accepts:
//  - JSON: [{ type, seat, stack, grid }] or { charts: [...] } (what "Exporter" writes);
//    a chart can give "ranges": { raise: "AA,AKs", allin: "...", ... } instead of a grid.
//  - Text: blocks starting with a header line ("open BTN 30bb", "BB vs CO 25bb",
//    "BB vs limp 20bb"), followed by 13 grid lines of 13 codes, or by action
//    lines ("raise: 22+,A2s+,KTo+", "allin: ...", "limp: ...", "call: ...", "light: ...").
//    Lines starting with // are comments.
export function parseChartText(text, source = 'texte') {
  const out = { charts: [], errors: [] };
  const t = String(text).replace(/^﻿/, '').trim();
  if (!t) return out;
  if (t[0] === '[' || t[0] === '{') {
    let data;
    try { data = JSON.parse(t); } catch (e) { out.errors.push(`${source} : JSON invalide (${e.message})`); return out; }
    const list = Array.isArray(data) ? data : data.charts || [data];
    list.forEach((raw, i) => addParsed(out, fromJson(raw), `${source} #${i + 1}`));
    return out;
  }
  let cur = null;
  const flush = () => { if (cur) addParsed(out, finish(cur), `${source} · ${cur.head}`); cur = null; };
  for (const line0 of t.split(/\r?\n/)) {
    const line = line0.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const head = parseHeader(line);
    if (head) { flush(); cur = { ...head, head: line.replace(/^[#\[\s]+|[\]\s]+$/g, ''), rows: [], ranges: {} }; continue; }
    if (!cur) { out.errors.push(`${source} : « ${line.slice(0, 40)} » avant tout en-tête (ex. « open BTN 30bb »)`); continue; }
    const act = line.match(/^([\w éèê-]+?)\s*[:=]\s*(.*)$/);
    if (act && actionOf(act[1])) { cur.ranges[actionOf(act[1])] = (cur.ranges[actionOf(act[1])] ? cur.ranges[actionOf(act[1])] + ',' : '') + act[2]; continue; }
    const row = line.replace(/[\s|,;\t]/g, '');
    const codes = cur.type === 'open' ? OPEN_CODES : BB_CODES_OK;
    if (row.length === 13 && [...row].every((x) => codes.includes(x))) cur.rows.push(row);
    else if (/[2-9TJQKA]/.test(line)) cur.ranges.raise = (cur.ranges.raise ? cur.ranges.raise + ',' : '') + line; // a bare range = raise
    else cur.bad = `ligne « ${line.slice(0, 40)} » illisible`;
  }
  flush();
  return out;
}

function addParsed(out, c, where) {
  if (c.error) { out.errors.push(`${where} : ${c.error}`); return; }
  const v = validate(c);
  if (v.ok) out.charts.push(c); else out.errors.push(`${where} : ${v.error}`);
}

function seatOf(s, type) {
  const x = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (type === 'open') return { UTG: 'LJ', MP: 'HJ', BU: 'BTN', BOUTON: 'BTN', D: 'BTN' }[x] || x;
  if (/^(VS)?LIMP(3BET|RERAISE|RELANCE)/.test(x)) return 'vsLimp3bet';
  if (/^(VS)?LIMP(SHOVE|TAPIS|JAM|ALLIN)/.test(x)) return 'vsLimpShove';
  if (/^(VS)?LIMP/.test(x)) return 'vsLimp';
  const y = x.replace(/^VS/, '');
  return { UTG: 'LJ', MP: 'HJ', BU: 'BTN', BOUTON: 'BTN' }[y] || y;
}

// "open BTN 30bb", "# BB vs CO 25bb", "[bb vs limp 20 bb]", "BTN open 30bb"
function parseHeader(line) {
  const l = line.replace(/^[#\[\s]+|[\]\s]+$/g, '');
  const stack = l.match(/(\d+(?:[.,]\d+)?)\s*bb\b/i);
  if (!stack) return null;
  const s = +stack[1].replace(',', '.');
  const rest = l.replace(stack[0], ' ').trim();
  const bb = rest.match(/^bb\s+(?:vs\.?\s*)?(?:open\s+)?(.+)$/i) || rest.match(/^(.+?)\s+bb$/i);
  if (bb) return { type: 'bb', seat: seatOf(bb[1].replace(/\s+/g, ''), 'bb'), stack: s };
  const op = rest.match(/^(?:open|ouverture|rfi)\s+(\w+)$/i) || rest.match(/^(\w+)\s+(?:open|ouverture|rfi)$/i);
  if (op) return { type: 'open', seat: seatOf(op[1], 'open'), stack: s };
  return null;
}

function fromJson(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'entrée vide' };
  const type = String(raw.type || '').toLowerCase() === 'bb' ? 'bb' : String(raw.type || '').toLowerCase() === 'open' ? 'open' : raw.type;
  const c = { type, seat: seatOf(raw.seat ?? raw.vs ?? raw.position, type), stack: +raw.stack, rows: [], ranges: {} };
  if (Array.isArray(raw.grid)) c.rows = raw.grid.map((r) => String(r).replace(/[\s|,;]/g, ''));
  else if (raw.ranges && typeof raw.ranges === 'object') for (const [k, v] of Object.entries(raw.ranges)) { if (actionOf(k)) c.ranges[actionOf(k)] = String(v); }
  else if (typeof raw.range === 'string') c.ranges.raise = raw.range;
  return finish(c);
}

const ACTIONS = { raise: 'raise', open: 'raise', r: 'raise', '3bet': 'raise', relance: 'raise', iso: 'raise', allin: 'allin', 'all-in': 'allin', tapis: 'allin', shove: 'allin', jam: 'allin', push: 'allin', limp: 'limp', call: 'call', suivre: 'call', paye: 'call', check: 'call', light: 'light', '3betlight': 'light', bluff: 'light' };
const actionOf = (s) => ACTIONS[s.toLowerCase().replace(/\s+/g, '')] || null;

function finish(c) {
  if (c.bad) return { error: c.bad };
  const { type, seat, stack } = c;
  if (c.rows.length) {
    if (c.rows.length !== 13) return { error: `${c.rows.length} ligne(s) de grille au lieu de 13` };
    return { type, seat, stack, grid: c.rows };
  }
  if (!Object.keys(c.ranges).length) return { error: 'ni grille ni range' };
  const w = {};
  for (const [act, str] of Object.entries(c.ranges)) {
    const r = parseRange(str);
    if (r.error) return r;
    w[act] = r.weights;
  }
  const grid = [];
  for (let row = 0; row < 13; row++) {
    let line = '';
    for (let col = 0; col < 13; col++) {
      const id = row * 13 + col, f = (a) => w[a]?.[id] || 0;
      line += type === 'open'
        ? openCode(f('raise'), f('allin'), f('limp'))
        : bbCode(f('raise'), f('allin'), f('call'), f('light'), seat === 'vsLimp');
    }
    grid.push(line);
  }
  return { type, seat, stack, grid };
}

// Frequencies -> the nearest chart code (charts only hold 0, 50 and 100 %).
const near = (x) => (x >= 0.75 ? 1 : x >= 0.25 ? 0.5 : 0);
function openCode(r, a, l) {
  [r, a, l] = [near(r), near(a), near(l)];
  if (a === 1) return 'A';
  if (r === 1) return 'R';
  if (l === 1) return 'M';
  if (a && l) return 'a';
  if (r && l) return 'H';
  if (a || r) return a ? 'A' : 'X';
  return l ? 'm' : 'F';
}
function bbCode(r, a, c, b, vsLimp) {
  [r, a, c, b] = [near(r), near(a), near(c), near(b)];
  if (b) return 'B';
  if (a === 1) return 'A';
  if (a && r) return 'j';
  if (a && c) return 'a';
  if (r === 1) return 'R';
  if (r && (c || vsLimp)) return 'r';
  if (vsLimp) return 'K';
  if (c === 1) return 'C';
  if (c) return 'c';
  return r ? 'r' : 'F';
}

// "22+, A2s+, KTo+, QJ, 76s-54s, AKo:0.5" -> weight per class (0..1).
export function parseRange(str) {
  const weights = new Float32Array(169);
  const R = (ch) => RANKS.indexOf(ch.toUpperCase());
  for (let tok of String(str).split(/[,;\s]+/)) {
    if (!tok) continue;
    let wt = 1;
    const m = tok.match(/^(.*?)[:@](\d*[.,]?\d+)(%?)$/);
    if (m) { tok = m[1]; wt = +m[2].replace(',', '.') / (m[3] || +m[2].replace(',', '.') > 1 ? 100 : 1); }
    const names = expand(tok, R);
    if (!names) return { error: `main « ${tok} » illisible dans la range` };
    for (const n of names) weights[CLASS_BY_NAME[n].id] = Math.max(weights[CLASS_BY_NAME[n].id], wt);
  }
  return { weights };
}

function nameOf(hi, lo, kind) {
  if (hi === lo) return RANKS[hi] + RANKS[hi];
  return RANKS[Math.max(hi, lo)] + RANKS[Math.min(hi, lo)] + kind;
}
function expand(tok, R) {
  const one = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/i);
  const plus = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)\+$/i);
  const dash = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/i);
  const kinds = (k, pair) => (pair ? [''] : k ? [k.toLowerCase()] : ['s', 'o']);
  if (one) {
    const [a, b] = [R(one[1]), R(one[2])];
    return kinds(one[3], a === b).map((k) => nameOf(a, b, k));
  }
  if (plus) {
    const [a, b] = [R(plus[1]), R(plus[2])];
    if (a === b) return Array.from({ length: 13 - a }, (_, i) => nameOf(a + i, a + i, ''));
    const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
    const out = [];
    for (let x = lo; x < hi; x++) for (const k of kinds(plus[3], false)) out.push(nameOf(hi, x, k));
    return out;
  }
  if (dash) {
    const [a1, b1, a2, b2] = [R(dash[1]), R(dash[2]), R(dash[4]), R(dash[5])];
    if (a1 === b1 && a2 === b2) {
      const out = [];
      for (let x = Math.min(a1, a2); x <= Math.max(a1, a2); x++) out.push(nameOf(x, x, ''));
      return out;
    }
    if (a1 !== a2) return null; // A5s-A2s: same top card
    const out = [];
    for (let x = Math.min(b1, b2); x <= Math.max(b1, b2); x++) if (x !== a1) for (const k of kinds(dash[3] || dash[6], false)) out.push(nameOf(a1, x, k));
    return out;
  }
  return null;
}

// Text template the "Modèle" button downloads.
export const TEMPLATE = `// Modèle d'import de chartes RaiseMyPoker
// Un bloc par chart : une ligne d'en-tête, puis la grille (13 lignes de 13 codes)
// ou des lignes d'actions avec des ranges (22+, A2s+, KTo+, 76s-54s, AKo:0.5).
// Grille : lignes et colonnes A K Q J T 9 8 7 6 5 4 3 2, suitées au-dessus de la diagonale.
// Codes open : R raise, A all-in, F fold, L Loosifie, T Tightfie, X raise/Tightfie,
//              SB : M limp, H raise/limp, a all-in/limp, m limp/fold
// Codes BB  : R 3bet (ou raise), A all-in, C call, K check, F fold, B 3bet light,
//              r raise/call, c call/fold, a all-in/call, j all-in/raise
// En-têtes : "open LJ|HJ|CO|BTN|SB 30bb", "BB vs LJ|HJ|CO|BTN|SB 30bb",
//            "BB vs limp 25bb", "BB vs limp-relance 25bb", "BB vs limp-tapis 25bb"
// Stacks possibles : ${STACKS.slice().sort((a, b) => a - b).join(', ')} bb

open BTN 30bb
raise: 22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o

BB vs CO 30bb
raise: QQ+, AKs, AKo, A5s:0.5
light: A4s, K9s, 76s
call: 22-JJ, A2s-AQs, KTs+, QTs+, JTs, T9s, 98s, 87s, AJo, AQo, KQo

open CO 40bb
RRRRRRRRRRRRR
RRRRRRRRRRRRX
RRRRRRRRRRXFF
RRRRRRRRXLFFF
RRRRRRRRXFFFF
RRLLXRRRXFFFF
RLFFFLRRRLFFF
RFFFFFFRRXFFF
LFFFFFFFRRFFF
LFFFFFFFFRXFF
FFFFFFFFFFRFF
FFFFFFFFFFFRF
FFFFFFFFFFFFX
`;

export const exportJson = () => JSON.stringify({ app: 'RaiseMyPoker', version: 1, charts }, null, 1);
