// Charts the user imports from Study (files or pasted text), kept in
// localStorage. They take precedence over the built-in charts:
//   open charts (first in, LJ..SB) for an exact stack, or for a chart depth
//   (20, 25, 50, 100bb) where they replace the built-in chart and its blends;
//   BB charts vs an open (LJ..SB), vs the SB's limp, limp-reraise or limp-shove.
// Same 13x13 layout and codes as the built-in charts (charts-50.js, charts-short.js).
import { CLASS_BY_NAME, RANKS } from '../engine/cards.js';
import { STACKS } from '../engine/game.js';
import { idbGet, idbSet, keepStorage } from './idb.js';

const KEY = 'rmp.userCharts.v1';
export const OPEN_SEATS = ['LJ', 'HJ', 'CO', 'BTN', 'SB'];
export const BB_VS = ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'vsLimp', 'vsLimp3bet', 'vsLimpShove'];
export const OPEN_CODES = 'RFLTXMHAam';
export const BB_CODES_OK = 'FCRBKcrAajqn';
const BB_TITLES = { vsLimp: 'BB vs limp SB', vsLimp3bet: 'BB vs limp-relance SB', vsLimpShove: 'BB vs limp-tapis SB' };
const BB_RAISE = { vsLimp: 'Raise', vsLimp3bet: 'Tapis', vsLimpShove: 'Tapis' };
// 'vs' charts: { type: 'vs', seat: the player deciding, vs: the other player, line, stack, grid }.
//   open: seat faces vs's open (the BB's is a 'bb' chart); shove: vs went
//   all-in (an open shove before seat, or a 3bet shove over seat's open);
//   3bet: seat opened and vs 3bet (the BB: it raised the SB's limp and the SB
//   3bet). Same codes as the BB's charts.
export const ALL_SEATS = ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
export const VS_LINES = ['open', 'shove', '3bet'];
const LINE_WORD = { open: 'open', shove: 'tapis', '3bet': '3bet' };
const LINE_RAISE = { open: '3bet', shove: 'Tapis', '3bet': '4bet' };
// Seats that can face this line from vs (open: after vs; shove: any other
// seat; 3bet: the opener, before vs, or the BB vs the SB).
export function vsSeats(line, vs) {
  const i = ALL_SEATS.indexOf(vs);
  if (i < 0) return [];
  if (line === 'shove') return ALL_SEATS.filter((s) => s !== vs);
  if (line === '3bet') return ALL_SEATS.filter((s, j) => (j < i && j < 5) || (vs === 'SB' && s === 'BB'));
  return ALL_SEATS.slice(i + 1);
}
// Seats that can make this line (open: LJ..SB; shove: any; 3bet: HJ..BB).
export const lineVillains = (line) => (line === '3bet' ? ALL_SEATS.slice(1) : line === 'shove' ? ALL_SEATS.slice() : ALL_SEATS.slice(0, 5));
// A shove from after the seat answers its open: a 3bet shove.
const lineWord = (c) => (c.line === 'shove' && ALL_SEATS.indexOf(c.vs) > ALL_SEATS.indexOf(c.seat) ? '3bet-tapis' : LINE_WORD[c.line] || '?');
// The chart's slot for a decision: the BB facing an open is a 'bb' chart.
export function spotOf(line, seat, vs) {
  if (line === 'open' && seat === 'BB') return { type: 'bb', seat: vs || null };
  return { type: 'vs', seat: seat || null, vs: vs || null, line };
}
// Which codes a chart's cells use: open charts', or the BB's set (every other chart).
export const codeFamily = (type) => (type === 'open' ? 'open' : 'bb');
// Is the spot fully named (seat, opponent when needed, stack)?
export const spotReady = (c) => !!(c && c.seat && c.stack && (c.type !== 'vs' || (c.vs && c.line)));

// Saved twice: in localStorage (read at once when the page opens) and in
// IndexedDB (room to spare: localStorage can be full of hand histories, and
// then a chart would only live until the next reload). The most recent copy
// wins when the page opens. A stored chart this version can't read is kept
// aside and written back, never dropped.
const AT_KEY = KEY + '.at';
let charts = [];
let kept = []; // stored entries that don't validate
let at = 0; // when charts last changed
const listeners = new Set();

function split(list) {
  const ok = [], bad = [];
  for (const c of Array.isArray(list) ? list : []) (validate(c).ok ? ok : bad).push(c);
  return [ok, bad];
}
try {
  [charts, kept] = split(JSON.parse(localStorage.getItem(KEY) || '[]'));
  at = +localStorage.getItem(AT_KEY) || 0;
} catch { /* blocked storage: IndexedDB below */ }

// The IndexedDB copy, when it is the more recent one.
export const userChartsReady = idbGet(KEY).then((rec) => {
  if (rec && Array.isArray(rec.charts) && rec.at > at) {
    [charts, kept] = split(rec.charts);
    at = rec.at;
    try { localStorage.setItem(KEY, JSON.stringify([...charts, ...kept])); localStorage.setItem(AT_KEY, String(at)); } catch { /* full */ }
    for (const f of listeners) f();
  } else if (charts.length || kept.length) idbSet(KEY, { charts: [...charts, ...kept], at });
});

function save() {
  at = Date.now();
  const all = [...charts, ...kept];
  let local = true;
  try { localStorage.setItem(KEY, JSON.stringify(all)); localStorage.setItem(AT_KEY, String(at)); } catch { local = false; }
  keepStorage();
  idbSet(KEY, { charts: all, at }).then((ok) => {
    // Neither copy written: the charts would be gone after a reload.
    if (!ok && !local) window.dispatchEvent(new CustomEvent('rmp:charts-not-saved'));
  });
  for (const f of listeners) f();
}

export const onUserCharts = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const getUserCharts = () => charts.slice();
// The spot's name: 'Open CO', 'BB vs open BTN', 'CO vs open LJ', 'BB vs tapis SB', 'LJ vs 3bet BTN'.
export function spotTitle(c) {
  if (c.type === 'open') return `Open ${c.seat || '?'}`;
  if (c.type === 'vs') return `${c.seat || '?'} vs ${lineWord(c)} ${c.vs || '?'}`;
  return BB_TITLES[c.seat] || `BB vs open ${c.seat || '?'}`;
}
export const chartLabel = (c) => `${spotTitle(c)} · ${c.stack}bb`;
export const slotKey = (c) => [c.type, c.seat, c.vs || '', c.line || '', c.stack].join('|');
const sameSlot = (a, b) => slotKey(a) === slotKey(b);

// Adds charts; one that has the same type, seat and stack replaces the old one.
export function addUserCharts(list) {
  for (const c of list) charts = [...charts.filter((o) => !sameSlot(o, c)), c];
  save();
}
export function removeUserChart(c) { charts = charts.filter((o) => !sameSlot(o, c)); save(); }
export function clearUserCharts() { charts = []; kept = []; save(); }

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
// A 'vs' chart in the BB charts' shape, or null.
export function userVsChart(seat, vs, line, stack) {
  const c = charts.find((o) => o.type === 'vs' && o.seat === seat && o.vs === vs && o.line === line && o.stack === stack);
  if (!c) return null;
  const grid = line === 'shove' ? c.grid.map(shoveRow) : c.grid;
  return { title: spotTitle(c) + ' (importé)', raiseLabel: LINE_RAISE[line], grid, user: true };
}
// The stacks the user imported a chart for in one slot (same spot, any stack).
export const userOpenStacks = (seat) => charts.filter((c) => c.type === 'open' && c.seat === seat).map((c) => c.stack);
export const userBbStacks = () => charts.filter((c) => c.type === 'bb').map((c) => c.stack);
export const userVsStacks = (seat, vs, line) => charts.filter((c) => c.type === 'vs' && c.seat === seat && c.vs === vs && c.line === line).map((c) => c.stack);
// The stack in the list nearest to `stack` (the shorter one on a tie), or null.
export function nearestStack(list, stack) {
  let best = null;
  for (const s of list) {
    const d = Math.abs(s - stack), bd = best == null ? Infinity : Math.abs(best - stack);
    if (d < bd || (d === bd && s < best)) best = s;
  }
  return best;
}
// Facing an all-in there is only call or fold: any aggressive code is a call.
export const shoveRow = (row) => row.replace(/[RABjraq]/g, 'C').replace(/[Kn]/g, 'F');

// ---------- validation ----------
export function validate(c) {
  if (!c || !['open', 'bb', 'vs'].includes(c.type)) return { ok: false, error: 'type inconnu (open, bb ou vs)' };
  if (c.type === 'vs') {
    if (!VS_LINES.includes(c.line)) return { ok: false, error: `situation « ${c.line ?? '?'} » inconnue (${VS_LINES.join(', ')})` };
    if (!lineVillains(c.line).includes(c.vs)) return { ok: false, error: `adversaire « ${c.vs ?? '?'} » impossible ici (${lineVillains(c.line).join(', ')})` };
    const ok = vsSeats(c.line, c.vs).filter((s) => !(c.line === 'open' && s === 'BB'));
    if (!ok.includes(c.seat)) return { ok: false, error: `${c.seat ?? '?'} ne peut pas jouer ce spot face à ${c.vs} (${ok.join(', ') || 'aucune position'})` };
  } else {
    const seats = c.type === 'open' ? OPEN_SEATS : BB_VS;
    if (!seats.includes(c.seat)) return { ok: false, error: `position « ${c.seat ?? '?'} » inconnue (${seats.join(', ')})` };
  }
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
  // "CO vs LJ 25bb", "BB vs SB shove 15bb", "LJ vs 3bet BTN 40bb".
  if (/\bvs\b|\bversus\b|\bfacing\b/i.test(rest) && !/limp/i.test(rest)) {
    const f = spotFromText(l);
    if (f.type === 'vs' && f.seat && f.vs) return { type: 'vs', seat: f.seat, vs: f.vs, line: f.line, stack: s };
  }
  const bb =rest.match(/^bb\s+(?:vs\.?\s*)?(?:open\s+)?(.+)$/i) || rest.match(/^(.+?)\s+bb$/i);
  if (bb) return { type: 'bb', seat: seatOf(bb[1].replace(/\s+/g, ''), 'bb'), stack: s };
  const op = rest.match(/^(?:open|ouverture|rfi)\s+(\w+)$/i) || rest.match(/^(\w+)\s+(?:open|ouverture|rfi)$/i);
  if (op) return { type: 'open', seat: seatOf(op[1], 'open'), stack: s };
  return null;
}

// The spot written on a chart image, from the text read on it (OCR): titles
// like "CO open 20bb", "Cutoff RFI 20 BB", "BB vs BTN 25bb", "Big Blind vs
// SB limp 20bb", "Button - Open - 30BB". { type, seat, stack, text } or null
// parts. OCR slips in numbers (O for 0, l for 1) are fixed before "bb".
const SEAT_WORDS = [
  [/\b(CUT\s*-?\s*OFF|CUTOFF|CO)\b/, 'CO'], [/\b(BUTTON|BOUTON|BTN|BU)\b/, 'BTN'], [/\b(HI\s*-?\s*JACK|HIJACK|HJ|MP)\b/, 'HJ'],
  [/\b(LO\s*-?\s*JACK|LOJACK|LJ|UTG)\b/, 'LJ'], [/\b(SMALL\s*BLIND|PETITE\s*BLINDE|SB)\b/, 'SB'],
];
const seatIn = (s) => {
  let best = null;
  for (const [re, seat] of SEAT_WORDS) { const m = s.match(re); if (m && (!best || m.index < best.i)) best = { i: m.index, seat }; }
  return best?.seat || null;
};
const STACK_RE = /(\d{1,3}(?:[.,]\d)?)\s*BB\b/g;
// One line, upper case, OCR slips fixed: "2O BB", "l5bb" -> "20 BB", "15bb".
const cleanLine = (l) => ' ' + l.toUpperCase().replace(/[|_]+/g, ' ').replace(/\s+/g, ' ')
  .replace(/([0-9OIL]{1,3})(?=\s*BB\b)/g, (m) => (/\d/.test(m) ? m.replace(/O/g, '0').replace(/[IL]/g, '1') : m))
  .replace(/\bBIG\s*BLIND\b|\bGROSSE\s*BLINDE\b/g, 'BB') + ' ';
// Stacks written on a line; under 8bb it is a bet size ("Raise 3bb"), not a stack.
const stacksIn = (l) => [...l.matchAll(STACK_RE)].map((m) => +m[1].replace(',', '.')).filter((v) => v >= 8);
// "BB" left once every "20bb" is gone: the seat, not the unit.
const noStacks = (l) => l.replace(STACK_RE, ' ');

export function spotFromText(raw) {
  const lines = String(raw).split(/\r?\n/).map(cleanLine).filter((l) => l.trim());
  // The title: the first line naming a position (or the BB facing something);
  // spot and stack come from it. Without one, from the whole text.
  const isTitle = (l) => seatIn(noStacks(l)) || /\bBB\b.*\b(VS|LIMP)/.test(noStacks(l));
  const title = lines.find((l) => isTitle(l) && stacksIn(l).length) || lines.find(isTitle);
  const all = lines.join(' ');
  const stack = Math.round((title && stacksIn(title)[0]) || stacksIn(all)[0] || 0) || null;
  const t = noStacks(title || all);
  let type = null, seat = null;
  const vs = t.match(/\bVS\.?\b|\bV\.S\.?\b|\bVERSUS\b|\bFACING\b|\bFACE\s*(A|À)\b|\bCONTRE\b|\bDEF(ENSE|ENCE)?\b/);
  if (/\bBB\b/.test(t) && /\bLIMP/.test(t)) {
    type = 'bb';
    if (/LIMP\s*-?\s*(3\s*-?\s*BET|RE\s*-?\s*RAISE|RERAISE|RELANCE|RAISE)/.test(t)) seat = 'vsLimp3bet';
    else if (/LIMP\s*-?\s*(SHOVE|JAM|TAPIS|ALL\s*-?\s*IN|PUSH)/.test(t)) seat = 'vsLimpShove';
    else seat = 'vsLimp';
  } else if (vs) {
    // "CO vs LJ open", "BB vs BTN shove", "LJ vs 3bet BTN", "Défense BB vs CO":
    // the seat before "vs" decides, the one after is the opponent.
    const seatOrBb = (s) => seatIn(s.replace(/\bBB\b/g, ' ')) || (/\bBB\b/.test(s) ? 'BB' : null);
    const hero = seatOrBb(t.slice(0, vs.index)) || (/\bBB\b/.test(t) ? 'BB' : null);
    const after = t.slice(vs.index + vs[0].length);
    const villain = hero === 'BB' ? seatIn(after.replace(/\bBB\b/g, ' ')) : seatOrBb(after);
    const H = ALL_SEATS.indexOf(hero), V = ALL_SEATS.indexOf(villain);
    const three = /\b(3\s*-?\s*B(ET)?|THREE\s*-?\s*BET)\b/.test(t);
    let line = /\b(SHOVE|JAM|PUSH|TAPIS|ALL\s*-?\s*IN|OPEN\s*-?\s*SHOVE)\b/.test(t) ? 'shove' : three ? '3bet' : 'open';
    // "BTN vs LJ 3bet", "SB 3bet shove vs CO": the hero 3bets (or 3bet
    // shoves) the opener's open: its chart facing the open.
    if ((line === '3bet' || (line === 'shove' && three)) && H >= 0 && V >= 0 && H > V && !(hero === 'BB' && villain === 'SB' && line === '3bet')) line = 'open';
    // "LJ vs BTN" (no word for the action): the LJ faces the BTN's 3bet.
    if (line === 'open' && !/\b(OPEN|RFI|RAISE)\b/.test(t) && H >= 0 && V >= 0 && H < V) line = '3bet';
    return { ...spotOf(line, hero, villain), stack };
  } else {
    seat = seatIn(t);
    if (seat || /\b(OPEN|RFI|OUVERTURE|FIRST\s*IN|SHOVE|PUSH)\b/.test(t)) type = 'open';
  }
  return { type, seat, stack };
}

// Best guess of the spot from a file name ("BB vs CO 25bb.png", "open_BTN_30bb.jpg",
// "SB 19bb.png"): { type, seat, stack }, any part may be missing.
export function guessSpot(name) {
  const s = String(name).replace(/\.[a-z0-9]+$/i, '').replace(/[_.]+/g, ' ').trim();
  const head = parseHeader(s);
  if (head && validate({ ...head, grid: Array(13).fill('F'.repeat(13)) }).ok) return head;
  const st = s.match(/(\d+(?:[.,]\d+)?)\s*bb\b/i) || s.match(/\b(\d{2,3})\b/);
  const stack = st ? +st[1].replace(',', '.') : null;
  const vs = s.match(/\bvs\.?\s*(.+)$/i);
  if (vs || /\bbb\b(?!\s*$)/i.test(s.replace(/\d+\s*bb/i, ''))) {
    const rest = (vs ? vs[1] : s.replace(/\d+(?:[.,]\d+)?\s*bb/i, '').replace(/\bbb\b/i, '')).replace(/\d+(?:[.,]\d+)?\s*bb/i, '').replace(/\s+/g, '');
    const seat = seatOf(rest.replace(/^open/i, ''), 'bb');
    return { type: 'bb', seat: BB_VS.includes(seat) ? seat : null, stack };
  }
  const tok = s.split(/[\s-]+/).map((t) => seatOf(t, 'open')).find((t) => OPEN_SEATS.includes(t));
  return { type: 'open', seat: tok || null, stack };
}

function fromJson(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'entrée vide' };
  const type = ['bb', 'open', 'vs'].includes(String(raw.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : raw.type;
  const c = type === 'vs'
    ? { type, seat: seatOf(raw.seat ?? raw.position, 'vs'), vs: seatOf(raw.vs, 'vs'), line: String(raw.line || '').toLowerCase(), stack: +raw.stack, rows: [], ranges: {} }
    : { type, seat: seatOf(raw.seat ?? raw.vs ?? raw.position, type), stack: +raw.stack, rows: [], ranges: {} };
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
  const spot = type === 'vs' ? { type, seat, vs: c.vs, line: c.line, stack } : { type, seat, stack };
  if (c.rows.length) {
    if (c.rows.length !== 13) return { error: `${c.rows.length} ligne(s) de grille au lieu de 13` };
    return { ...spot, grid: c.rows };
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
  return { ...spot, grid };
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
//            "BB vs limp 25bb", "BB vs limp-relance 25bb", "BB vs limp-tapis 25bb",
//            "CO vs open LJ 25bb", "BB vs shove BTN 15bb", "LJ vs 3bet BTN 40bb"
//            (codes BB ; face à un tapis : C call, F fold, c call/fold)
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
