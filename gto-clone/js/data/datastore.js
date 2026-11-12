// My Data storage: imported tournaments, the hero's preflop decisions, one
// small record per hand, and the import sessions — kept in this browser only
// (localStorage key gtoc.data.v1).
import { parseFile, money } from './parsers.js';
import { extractDecisions } from './decisions.js';
import { handRecord } from './handstats.js';
import { hashStr } from '../engine/rng.js';

// Anti-duplicate rule:
// - a file already imported (same content) is skipped;
// - a tournament is identified by room + tournament number: importing it
//   again updates it, it is never added twice;
// - a hand is identified by its hand number: the same hand is kept once,
//   even when it shows up in two files.
const KEY = /[?&]test=1/.test(location.search) ? 'gtoc.data.test' : 'gtoc.data.v1';
export const DATA_KEY = KEY;
// v2: Winamax uncalled bets and re-entries read from the hands. Hand records
// are only rebuilt from the files, so older data asks for one re-import.
const VERSION = 2;
const EMPTY = () => ({ v: VERSION, tournaments: {}, decisions: {}, hands: {}, sessions: [], screenNames: [], files: {} });
const fingerprint = (text) => `${text.length}:${hashStr(text)}`;
let db = load();

function load() {
  let d;
  try { d = { ...EMPTY(), v: 1, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return EMPTY(); }
  if (d.v < VERSION) {
    // Files are read again on the next import or gateway sync (hands are replaced, never doubled).
    for (const key in d.hands) if (d.tournaments[key] && d.hands[key].length) d.tournaments[key].stale = true;
    // Prizes read from a summary row used to keep the percentage's digits (30.345 for "€30.34 (5.186%)").
    for (const t of Object.values(d.tournaments)) {
      t.entries = 1 + (t.reentries || 0);
      if (!(Math.abs(t.prize * 100 - Math.round(t.prize * 100)) > 1e-6)) continue;
      const row = t.rows?.map((r) => r.match(/^\s*\d+: (.+?)(?: \[\d+\])? \([^)]*\),\s*(.*)$/)).find((m) => m && d.screenNames.includes(m[1]));
      if (row) { t.prize = money(row[2]); t.winnings = t.prize + (t.bounties || 0); t.profit = t.winnings - (t.cost || 0); }
    }
    d.files = {};
    for (const k in d) if (k.startsWith('gateway') && d[k]) d[k] = { ...d[k], seen: {}, last: null };
    d.v = VERSION;
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage full */ }
  }
  return d;
}
// Tournaments whose hands were imported before the last fix of the numbers.
export const staleCount = () => Object.values(db.tournaments).filter((t) => t.stale).length;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch { return false; }
}

export const getTournaments = () => Object.values(db.tournaments).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.tid.localeCompare(a.tid));
export const getDecisions = () => Object.values(db.decisions).flat();
export const getHandRecords = () => Object.values(db.hands).flat().sort((a, b) => (a.at || '').localeCompare(b.at || '') || String(a.h).localeCompare(String(b.h)));
export const getImportSessions = () => db.sessions.slice().reverse();
export const getScreenNames = () => db.screenNames;
// Gateway state, one per room: which folder, when it last synced, and each file's size+date seen.
// Winamax keeps the first key ("gateway") so a folder connected before stays connected.
const gwKey = (room) => (room === 'winamax' ? 'gateway' : `gateway_${room}`);
export const getGateway = (room = 'winamax') => db[gwKey(room)] || { seen: {}, folder: null, last: null };
export function setGateway(g, room = 'winamax') { db[gwKey(room)] = g; save(); }
export function setScreenNames(list) { db.screenNames = list; Object.values(db.tournaments).forEach(derive); save(); }
export function setType(key, type) { if (db.tournaments[key]) { db.tournaments[key].type = type; db.tournaments[key].typeSet = true; save(); } }
export function removeTournament(key) {
  delete db.tournaments[key]; delete db.decisions[key]; delete db.hands[key];
  for (const fp in db.files) if (db.files[fp] === key) delete db.files[fp]; // so it can be imported again
  save();
}
// The connected folders stay connected; their files will be read again on the next sync.
export function clearAll() {
  const gateways = {};
  for (const k in db) if (k.startsWith('gateway') && db[k]) gateways[k] = { ...db[k], seen: {}, last: null };
  db = { ...EMPTY(), screenNames: db.screenNames, ...gateways };
  save();
}

function tour(room, tid) {
  const key = `${room}:${tid}`;
  if (!db.tournaments[key]) db.tournaments[key] = { key, room, tid, name: `${room} #${tid}`, type: 'vanilla', files: [] };
  return db.tournaments[key];
}

// Place and prize from the summary's player list when the "You ..." lines don't say.
function derive(t) {
  if ((t.place == null || t.prize == null) && t.rows?.length && db.screenNames.length) {
    for (const row of t.rows) {
      const m = row.match(/^\s*(\d+): (.+?)(?: \[\d+\])? \([^)]*\),\s*(.*)$/);
      if (!m || !db.screenNames.includes(m[2])) continue;
      if (/still playing/.test(m[3])) { t.running = true; break; }
      if (t.place == null) t.place = +m[1];
      if (t.prize == null) t.prize = money(m[3]); // the first amount: "€30.34 (5.186%)" is 30.34
      break;
    }
  }
  // Re-entries: the summary's count, or the busts followed by more hands in the history.
  const re = Math.max(t.reentries || 0, t.hhReentries || 0);
  const buyin = t.buyin || 0; // the hand history's buy-in only counts for the ABI: profit waits for the summary
  t.entries = 1 + re;
  t.cost = buyin + (t.reentryCost && (t.reentries || 0) >= re ? t.reentryCost : buyin * re);
  t.bounties = (t.bounty || 0) + (t.hhBounty || 0);
  t.winnings = (t.prize || 0) + t.bounties;
  t.profit = t.winnings - t.cost;
}

// files: [{name, text}] -> report. Each call that brings something new is one import session.
export function importFiles(files, { source = 'manual' } = {}) {
  const sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const report = { ok: 0, errors: [], tournaments: new Set(), decisions: 0, skipped: 0, hands: 0, newHands: 0, duplicates: [], newTournaments: 0, session: sid };
  const seen = new Set();
  for (const f of files) {
    const fp = fingerprint(f.text);
    if (db.files[fp] || seen.has(fp)) { report.duplicates.push(f.name); continue; }
    const res = parseFile(f.text);
    if (res.error) { report.errors.push(`${f.name} : ${res.error}`); continue; }
    seen.add(fp);
    if (res.summary) {
      const s = res.summary;
      if (!db.tournaments[`${s.room}:${s.tid}`]) report.newTournaments++;
      const t = tour(s.room, s.tid);
      // The user's choice wins; so does a KO seen in the hands (a PokerStars summary doesn't show the bounty part).
      const keepType = t.typeSet || (t.type !== 'vanilla' && s.type === 'vanilla') ? t.type : null;
      Object.assign(t, s, { files: [...new Set([...t.files, 'summary'])] });
      if (keepType) t.type = keepType;
      t.session = t.session || sid;
      db.files[fp] = t.key;
      report.tournaments.add(t.key);
    } else {
      const hh = res.hands;
      if (!hh.tid) { report.errors.push(`${f.name} : aucune main trouvée`); continue; }
      if (!db.tournaments[`${hh.room}:${hh.tid}`]) report.newTournaments++;
      const t = tour(hh.room, hh.tid);
      t.session = t.session || sid;
      if (hh.hero && !db.screenNames.includes(hh.hero)) db.screenNames.push(hh.hero);
      if (hh.isKO && !t.typeSet && t.type === 'vanilla') t.type = 'ko';
      if (hh.buyin) t.hhBuyin = hh.buyin; // only for the ABI: profit waits for the summary
      if (!t.name || t.name.startsWith(hh.room + ' #')) t.name = hh.hands[0]?.name || t.name;
      // Hands already stored (same hand number) are replaced, never doubled.
      const ids = new Set(hh.hands.map((x) => String(x.id)));
      const before = new Map((db.hands[t.key] || []).map((r) => [String(r.h), r.s])); // hand -> session that first brought it
      const decisions = [];
      let skipped = 0;
      for (const hand of hh.hands) {
        const r = extractDecisions(hand);
        decisions.push(...r.decisions);
        skipped += r.skipped;
      }
      db.decisions[t.key] = [...(db.decisions[t.key] || []).filter((d) => !ids.has(String(d.h))), ...decisions];
      const recs = hh.hands.map(handRecord).filter(Boolean).map((r) => ({ ...r, s: before.get(String(r.h)) || sid }));
      db.hands[t.key] = [...(db.hands[t.key] || []).filter((r) => !ids.has(String(r.h))), ...recs];
      t.handsCount = db.hands[t.key].length;
      t.hhBounty = db.hands[t.key].reduce((a, r) => a + (r.b || 0), 0);
      // A bust followed by more hands is a re-entry.
      const order = db.hands[t.key].slice().sort((a, b) => (a.at || '').localeCompare(b.at || '') || String(a.h).localeCompare(String(b.h)));
      t.hhReentries = order.slice(0, -1).filter((r) => r.x).length;
      delete t.stale;
      t.files = [...new Set([...t.files, 'hands'])];
      db.files[fp] = t.key;
      report.decisions += decisions.length;
      report.hands += hh.hands.length;
      report.newHands += [...ids].filter((id) => !before.has(id)).length;
      report.skipped += skipped;
      report.tournaments.add(t.key);
    }
    report.ok++;
  }
  if (report.newTournaments || report.newHands) db.sessions.push({ id: sid, at: new Date().toISOString(), files: report.ok, hands: report.newHands, keys: [...report.tournaments], source });
  Object.values(db.tournaments).forEach(derive);
  report.saved = save();
  return report;
}
