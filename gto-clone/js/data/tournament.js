// A simulated tournament around the hero's table: prize pool, rising blinds, a
// field that shrinks to reach the end in the chosen number of hands, real ICM
// pressure (cfg.bf, the same input as Study) and elimination. Chips are the
// truth here; each hand is played by the engine at the hero's effective stack.
import { evalHand } from '../engine/evaluator.js';
import { anteOf } from '../engine/game.js';
import { bubbleFactor, icmEquities } from '../engine/icm.js';

export const BUYIN = 10;
const START_BB = 50;
const BB0 = 100;
const END_AVG_BB = 20; // average stack in big blinds when the end nears
const MAX_ICM = 14; // icm.js computes exactly up to 14 players
const round2 = (x) => { const m = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1); return Math.round(x / m) * m; };
const spread = () => Math.exp((Math.random() + Math.random() + Math.random() - 1.5) * 0.7); // around 1, from about 0.35 to 2.9

// Top 15% paid, the top prizes much bigger than the min-cash.
export function prizeLadder(players, pool) {
  const paid = Math.max(1, Math.round(players * 0.15));
  const w = Array.from({ length: paid }, (_, i) => 1 / (i + 1));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (x / sum) * pool);
}

export function createTournament({ players, hands, ko }) {
  const total = players * BUYIN;
  const pool = ko ? total / 2 : total;
  const start = START_BB * BB0;
  const t = {
    players, hands, ko, pool, ladder: prizeLadder(players, pool), bounty0: ko ? BUYIN / 2 : 0,
    bb: BB0, level: 1, hand: 0, left: players, totalChips: players * start,
    hero: { chips: start, won: 0, head: ko ? BUYIN / 2 : 0, ko: 0 },
    table: [], avg: start, done: null, log: [],
  };
  for (let i = 0; i < Math.min(5, players - 1); i++) t.table.push(newcomer(t));
  return t;
}

function newcomer(t) { return { chips: t.avg * spread(), bounty: t.bounty0 * (t.ko ? spread() : 0) }; }

// Field left after hand h: down to 2 players on the last hand.
export const fieldAt = (t, h) => Math.max(2, Math.round(t.players * (2 / t.players) ** (h / t.hands)));

// Bubble factor of the hero against this table. Exact when the money is near;
// a full field can't be computed, so the next 14 places stand in for it.
export function heroBubbleFactor(t) {
  const paid = t.ladder.length;
  const d = t.left - paid;
  let pays;
  if (t.left <= MAX_ICM) pays = t.ladder.slice(0, t.left);
  else if (d >= MAX_ICM) return Math.max(1, 1 + 0.5 * (MAX_ICM / d) ** 2);
  else if (d > 0) pays = t.ladder.slice(Math.max(0, paid - (MAX_ICM - d)), paid);
  else pays = t.ladder.slice(t.left - MAX_ICM, t.left);
  const n = Math.min(t.left, MAX_ICM);
  const stacks = [t.hero.chips, ...t.table.map((o) => o.chips)];
  while (stacks.length < n) stacks.push(t.avg);
  const opp = t.table.map((_, i) => i + 1);
  if (!opp.length) return 1;
  const bf = opp.reduce((a, i) => a + bubbleFactor(stacks, pays, 0, i), 0) / opp.length;
  return bf < 1.02 ? 1 : Math.min(3, bf);
}

const stageOf = (t) => {
  if (t.left <= 2) return 'hu';
  if (t.left <= 6) return 'ft';
  if (t.left <= 12) return 'semi';
  const r = t.left / t.players;
  return r <= 0.1 ? '10' : r <= 0.25 ? '25' : r <= 0.5 ? '50' : '100';
};

// One player out at this table, the short stacks first.
function bustAtTable(t) {
  const w = t.table.map((o) => 1 / Math.max(1, o.chips));
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < w.length - 1 && (x -= w[i]) > 0) i++;
  t.table.splice(i, 1);
}

// Moves the tournament to its next hand: the field, the blinds, the stacks.
// Returns what the engine needs, or null when the tournament is over.
export function nextHand(t) {
  if (t.done) return null;
  if (t.hand >= t.hands) { finishByDeal(t); return null; }
  t.hand++;
  const target = fieldAt(t, t.hand);
  while (t.left > target) {
    if (t.left <= 6) { if (!t.table.length) break; bustAtTable(t); } else if (Math.random() < 5 / t.left) { bustAtTable(t); t.table.push(newcomer(t)); }
    t.left--;
  }
  if (t.left <= 1) { finish(t, 1); return null; }
  const prevAvg = t.avg;
  t.avg = t.totalChips / t.left;
  while (t.table.length > t.left - 1) bustAtTable(t);
  for (const o of t.table) o.chips *= (t.avg / prevAvg) * (0.9 + Math.random() * 0.2);
  if (t.left <= 6) { // everybody left is here: the chips must add up
    const k = (t.totalChips - t.hero.chips) / t.table.reduce((a, o) => a + o.chips, 0);
    for (const o of t.table) o.chips *= k;
  }
  const p = t.hand / t.hands;
  t.bb = Math.max(t.bb, round2(t.avg / (START_BB * (1 - p) + END_AVG_BB * p)));
  const level = 1 + Math.floor((t.hand - 1) / Math.max(1, Math.round(t.hands / 12)));
  t.level = level;
  for (const o of t.table) o.chips = Math.max(o.chips, 2 * t.bb); // a seat always covers its blind and ante

  const order = [-1, ...t.table.keys()]; // -1 is the hero
  const n = order.length;
  const live = n === 2 ? [4, 5] : Array.from({ length: n }, (_, i) => 6 - n + i);
  const seats = Array(6).fill(null);
  order.forEach((who, i) => { seats[live[(i + t.hand) % n]] = who; });
  const hero = seats.indexOf(-1);
  const stacks = seats.map((who) => (who == null ? 0 : (who < 0 ? t.hero.chips : t.table[who].chips) / t.bb));
  const others = stacks.filter((_, p) => p !== hero && seats[p] != null);
  const eff = Math.min(stacks[hero], Math.max(...others));
  // Above 15bb the hand is played at the real depth; below, at the depths the
  // push/fold equilibrium is computed for (each one takes seconds), scaled.
  const stack = eff > 15 ? Math.round(eff) : eff > 12 ? 15 : 10;
  const cfg = { stack, open: stack < 37.5 ? '2' : '2.5', ko: t.ko, stage: stageOf(t), multiway: true, bf: heroBubbleFactor(t) };
  if (others.every((s) => s < stacks[hero])) cfg.big = hero;
  else if (others.every((s) => s > stacks[hero])) cfg.short = hero;
  return { cfg, hero, live, seats, stacks, scale: eff / stack };
}

// Real big blinds behind what the engine calls `inv`: the blinds are what they
// are, everything else follows the effective stack.
export const realBet = (inv, scale) => (inv <= 1 ? inv : inv * scale);

// Chips each seat gets back from the pots (side pots included). contrib: real
// amount per seat; vals: hand value per seat, null for a folded one; dead: the
// ante, which belongs to the main pot.
export function splitPots(contrib, vals, dead = 0) {
  const won = contrib.map(() => 0);
  const levels = [...new Set(contrib.filter((c) => c > 0))].sort((a, b) => a - b);
  let prev = 0;
  for (const lv of levels) {
    const inPot = contrib.map((c, p) => (c >= lv ? p : -1)).filter((p) => p >= 0);
    const amount = (lv - prev) * inPot.length + (prev === 0 ? dead : 0);
    prev = lv;
    const able = inPot.filter((p) => vals[p] != null);
    // Everybody who paid this level folded: it goes to the players still in.
    const pool = able.length ? able : vals.map((v, p) => (v != null ? p : -1)).filter((p) => p >= 0);
    const best = Math.max(...pool.map((p) => vals[p]));
    const winners = pool.filter((p) => vals[p] === best);
    for (const p of winners) won[p] += amount / winners.length;
  }
  return won;
}

// Settles a finished hand. st: engine state, deal: nextHand's result, hands and
// board: the cards. Returns the hero's net in big blinds and who went out.
export function settleHand(t, st, deal, hands, board) {
  const { seats, stacks, scale, hero } = deal;
  const ante = Math.min(stacks[5], anteOf(st.cfg)); // the BB is always seated
  const contrib = st.invested.map((inv, p) => (seats[p] == null ? 0 : Math.min(stacks[p] - (p === 5 ? ante : 0), realBet(inv, scale))));
  const live = seats.map((who, p) => (who != null && !st.folded[p] ? p : -1)).filter((p) => p >= 0);
  const vals = seats.map(() => null);
  if (live.length === 1) vals[live[0]] = 1;
  else for (const p of live) vals[p] = evalHand(hands[p][0], hands[p][1], board);
  const won = splitPots(contrib, vals, ante);
  const net = contrib.map((c, p) => won[p] - c - (p === 5 ? ante : 0));
  const out = [];
  t.hero.chips = Math.max(0, t.hero.chips + net[hero] * t.bb);
  seats.forEach((who, p) => {
    if (who == null || who < 0) return;
    t.table[who].chips += net[p] * t.bb;
    if (t.table[who].chips < 0.01 * t.bb) out.push({ who, p });
  });
  let bounty = 0;
  if (t.ko && net[hero] > 0) {
    for (const { who, p } of out) {
      if (contrib[p] <= 0 || won[p] > 0) continue;
      const b = t.table[who].bounty;
      bounty += b / 2; t.hero.won += b / 2; t.hero.head += b / 2; t.hero.ko++;
    }
  }
  const heroOut = t.hero.chips < 0.01 * t.bb;
  const place = t.left; // the hero's place if out now, shared busts count as the best one
  for (const { who } of [...out].sort((a, b) => b.who - a.who)) {
    t.table.splice(who, 1);
    if (t.left - out.length >= 6 && !heroOut) t.table.splice(who, 0, newcomer(t));
  }
  t.left -= out.length;
  t.avg = t.totalChips / Math.max(1, t.left);
  if (heroOut) finish(t, place);
  else if (t.left <= 1) finish(t, 1);
  else if (t.hand >= t.hands) finishByDeal(t);
  return { net: net[hero], out: out.length, heroOut, bounty };
}

function finish(t, place, prize = t.ladder[place - 1] || 0) {
  t.done = { place, prize, bounties: t.hero.won, ko: t.hero.ko, total: prize + t.hero.won };
}

// Last hand played: a deal at ICM between the players still in.
function finishByDeal(t) {
  const stacks = [t.hero.chips, ...t.table.map((o) => o.chips)];
  const place = 1 + t.table.filter((o) => o.chips > t.hero.chips).length + Math.max(0, t.left - stacks.length);
  const prize = t.left === stacks.length ? icmEquities(stacks, t.ladder.slice(0, stacks.length))[0] : t.ladder[place - 1] || 0;
  finish(t, place, prize);
  t.done.deal = true;
}

// What the decision was about, to sort the recap.
export function decisionTags(st, t, deal) {
  const tags = [];
  if (st.street > 0) tags.push('postflop');
  else if (st.raiseLevel === 0 && !st.limpers.length) tags.push('open');
  else if (st.toAct === 5) tags.push('bb');
  else tags.push(st.raiseLevel >= 2 ? 'vs3bet' : 'vsopen');
  if (st.cfg.stack <= 15) tags.push('short');
  if (st.cfg.bf >= 1.2) tags.push('icm');
  if (t.left > t.ladder.length && t.left - t.ladder.length <= Math.max(3, t.ladder.length * 0.15)) tags.push('bubble');
  if (deal.seats.filter((x) => x != null).length <= 3) tags.push('short-table');
  return tags;
}

const CATS = {
  open: ['Ouvertures', 'Tu ne relances pas les bonnes mains quand tout le monde a foldé jusqu\'à toi.'],
  vsopen: ['Face à un open', 'Tes réponses aux relances (fold, call, 3-bet) s\'écartent de la stratégie.'],
  bb: ['Défense de la big blind', 'Ta défense en BB s\'écarte de tes charts et du modèle.'],
  vs3bet: ['Face à un 3-bet', 'Tes réponses aux 3-bets et plus s\'écartent de la stratégie.'],
  postflop: ['Après le flop', 'Tes mises et tes calls après le flop s\'écartent de la stratégie.'],
  short: ['Tapis courts (15bb et moins)', 'À tapis court, revois tes ranges de tapis et de call.'],
  icm: ['Pression ICM', 'Sous pression ICM, un jeton perdu coûte plus qu\'un jeton gagné ne rapporte : ajuste tes calls.'],
  bubble: ['La bulle', 'Près de l\'argent, tes décisions perdent le plus de valeur.'],
  'short-table': ['Table réduite (3 joueurs ou moins)', 'À peu de joueurs, les ranges s\'élargissent beaucoup.'],
};
const LEVELS = [[17, 'Crusher'], [14, 'Solide'], [11, 'Correct'], [8, 'Amateur'], [0, 'Débutant']];

// The hero's level: only his decisions against the Study strategy count, not
// the cards or the result. score is the grade used everywhere in training.
export function tournamentReport(decisions) {
  const n = decisions.length;
  const good = (d) => d.grade === 'best' || d.grade === 'correct';
  const avg = n ? decisions.reduce((a, d) => a + d.score, 0) / n : 0;
  const note = Math.round(Math.max(0, avg) * 200) / 10;
  const direction = (list) => {
    let tight = 0, loose = 0;
    for (const d of list) {
      if (good(d)) continue;
      if (d.chosen === 'Fold') tight++; else if (d.best === 'Fold') loose++;
    }
    return { tight, loose };
  };
  const cats = Object.entries(CATS).map(([id, [name, tip]]) => {
    const list = decisions.filter((d) => d.tags?.includes(id));
    if (!list.length) return null;
    return { id, name, tip, n: list.length, avg: list.reduce((a, d) => a + d.score, 0) / list.length, errors: list.filter((d) => !good(d)).length, ev: list.reduce((a, d) => a + d.evLoss, 0), ...direction(list) };
  }).filter(Boolean);
  const rank = { blunder: 0, wrong: 1, inaccuracy: 2 };
  return {
    n, note, level: n >= 5 ? LEVELS.find(([min]) => note >= min)[1] : null,
    errors: decisions.filter((d) => !good(d)).length, ev: decisions.reduce((a, d) => a + d.evLoss, 0),
    strong: cats.filter((c) => c.n >= 3 && c.avg >= 0.75).sort((a, b) => b.avg - a.avg),
    weak: cats.filter((c) => c.n >= 2 && c.avg < 0.6).sort((a, b) => a.avg - b.avg),
    cats, ...direction(decisions),
    worst: decisions.filter((d) => !good(d)).sort((a, b) => rank[a.grade] - rank[b.grade] || b.evLoss - a.evLoss).slice(0, 5),
  };
}
