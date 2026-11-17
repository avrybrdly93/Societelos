'use strict';

// Manual math checks for the Cycle 5 finale: the Borda count and its
// 50/25/25 package (TASK-593), and the role points and author bonus
// (TASK-594). Every expected number below is worked out by hand in the
// comments, so a reviewer can check the arithmetic without running code.

const test = require('node:test');
const assert = require('node:assert/strict');

const { bordaCount, rankBorda, selectEnacted, packageEffects } = require('../finale');

// Five ballots (best first). Each voter ranks the 4 policies they did not write:
// NODE-01 wrote P1, NODE-02 wrote P2, ... NODE-05 wrote P5.
const BALLOTS = {
  'NODE-01': ['POLICY-3', 'POLICY-2', 'POLICY-5', 'POLICY-4'],
  'NODE-02': ['POLICY-3', 'POLICY-1', 'POLICY-4', 'POLICY-5'],
  'NODE-03': ['POLICY-1', 'POLICY-2', 'POLICY-4', 'POLICY-5'],
  'NODE-04': ['POLICY-3', 'POLICY-1', 'POLICY-2', 'POLICY-5'],
  'NODE-05': ['POLICY-2', 'POLICY-3', 'POLICY-1', 'POLICY-4']
};
const IDS = ['POLICY-1', 'POLICY-2', 'POLICY-3', 'POLICY-4', 'POLICY-5'];

// Points 4/3/2/1 by place. By hand:
//   P1: 3 (N2 2nd) + 4 (N3 1st) + 3 (N4 2nd) + 2 (N5 3rd)        = 12, places [1,2,1,0]
//   P2: 3 (N1 2nd) + 3 (N3 2nd) + 2 (N4 3rd) + 4 (N5 1st)        = 12, places [1,2,1,0]
//   P3: 4 (N1) + 4 (N2) + 4 (N4) + 3 (N5 2nd)                     = 15, places [3,1,0,0]
//   P4: 1 (N1 4th) + 2 (N2 3rd) + 2 (N3 3rd) + 1 (N5 4th)         =  6, places [0,0,2,2]
//   P5: 2 (N1 3rd) + 1 (N2 4th) + 1 (N3 4th) + 1 (N4 4th)         =  5, places [0,0,1,3]
// Total = 12+12+15+6+5 = 50 = 5 ballots x (4+3+2+1). P1 and P2 tie on points,
// 1st places and 2nd places, so the forecast median breaks it.
const HAND_TALLY = {
  'POLICY-1': { points: 12, places: [1, 2, 1, 0] },
  'POLICY-2': { points: 12, places: [1, 2, 1, 0] },
  'POLICY-3': { points: 15, places: [3, 1, 0, 0] },
  'POLICY-4': { points: 6, places: [0, 0, 2, 2] },
  'POLICY-5': { points: 5, places: [0, 0, 1, 3] }
};

const EFFECTS = {
  'POLICY-1': { purpose: 0.4, connection: 0, health: -0.2, trust: 0, fairness: 0.6, autonomy: 0 },
  'POLICY-2': { purpose: 0, connection: 0.8, health: 0, trust: -0.4, fairness: 0, autonomy: 0 },
  'POLICY-3': { purpose: 0.6, connection: 0, health: 0, trust: 0.2, fairness: -0.4, autonomy: 1.0 },
  'POLICY-4': { purpose: -1, connection: -1, health: -1, trust: -1, fairness: -1, autonomy: -1 },
  'POLICY-5': { purpose: 1, connection: 1, health: 1, trust: 1, fairness: 1, autonomy: 1 }
};

test('TASK-593: Borda tally of five ballots matches the hand count (4/3/2/1, 50 points total)', () => {
  const tally = bordaCount(BALLOTS, IDS);
  assert.deepEqual(tally, HAND_TALLY);
  assert.equal(Object.values(tally).reduce((s, t) => s + t.points, 0), 50);
});

test('TASK-593: ranking, tie-break and 50/25/25 package match the hand calculation', () => {
  // P2's single-policy forecast median is higher, so P2 beats P1 on the tie.
  const medians = { 'POLICY-1': 24.1, 'POLICY-2': 27.9, 'POLICY-3': 30, 'POLICY-4': 10, 'POLICY-5': 40 };
  const rows = rankBorda(bordaCount(BALLOTS, IDS), (id) => medians[id]);
  assert.deepEqual(rows.map((r) => r.id), ['POLICY-3', 'POLICY-2', 'POLICY-1', 'POLICY-4', 'POLICY-5']);

  const enacted = selectEnacted(rows);
  assert.deepEqual(enacted, [
    { id: 'POLICY-3', place: 'first', weight: 0.5, points: 15 },
    { id: 'POLICY-2', place: 'second', weight: 0.25, points: 12 },
    { id: 'POLICY-1', place: 'third', weight: 0.25, points: 12 }
  ]);

  // e = 0.50 P3 + 0.25 P2 + 0.25 P1, trait by trait:
  //   purpose    0.5(0.6)  + 0.25(0)    + 0.25(0.4)  = 0.30 + 0    + 0.10 =  0.40
  //   connection 0.5(0)    + 0.25(0.8)  + 0.25(0)    = 0    + 0.20 + 0    =  0.20
  //   health     0.5(0)    + 0.25(0)    + 0.25(-0.2) = 0    + 0    - 0.05 = -0.05
  //   trust      0.5(0.2)  + 0.25(-0.4) + 0.25(0)    = 0.10 - 0.10 + 0    =  0
  //   fairness   0.5(-0.4) + 0.25(0)    + 0.25(0.6)  = -0.20 + 0   + 0.15 = -0.05
  //   autonomy   0.5(1.0)  + 0.25(0)    + 0.25(0)    = 0.50              =  0.50
  // The 4th and 5th policies (P4, P5) contribute nothing.
  assert.deepEqual(packageEffects(enacted, (id) => EFFECTS[id]), {
    purpose: 0.4, connection: 0.2, health: -0.05, trust: 0, fairness: -0.05, autonomy: 0.5
  });
});

test('TASK-593: without a tie-break median the ids order the tie (P1 before P2)', () => {
  const rows = rankBorda(bordaCount(BALLOTS, IDS));
  assert.deepEqual(rows.slice(0, 3).map((r) => r.id), ['POLICY-3', 'POLICY-1', 'POLICY-2']);
});

// --- TASK-594: role points and author bonus ---------------------------------

const { GameState, NODE_IDS } = require('../gameEngine');

/** A seated game with a fixed secret role per node and zeroed scores. */
function seatedGame() {
  const log = console.log;
  console.log = () => {};
  const game = new GameState({ roomCode: 'MATH' });
  NODE_IDS.forEach((node, i) => game.addPlayer(`s${i}`, `P${i}`));
  console.log = log;
  const roles = { 'NODE-01': 'artisan', 'NODE-02': 'lotus', 'NODE-03': 'ghost', 'NODE-04': 'assimilator', 'NODE-05': 'catalyst' };
  game.roleAssignment = Object.fromEntries(Object.entries(roles).map(([n, key]) => [n, { key }]));
  game.scores = Object.fromEntries(NODE_IDS.map((n) => [n, 0]));
  return game;
}

/** The finale above: P3 1st (50%), P2 2nd (25%), P1 3rd (25%). */
function finaleGame() {
  const game = seatedGame();
  game.finale = {
    policies: [
      { id: 'POLICY-1', node: 'NODE-02', roles: ['lotus'] },
      { id: 'POLICY-2', node: 'NODE-01', roles: ['artisan'] },
      { id: 'POLICY-3', node: 'NODE-04', roles: ['artisan', 'ghost'] },
      { id: 'POLICY-4', node: 'NODE-03', roles: ['assimilator'] },
      { id: 'POLICY-5', node: 'NODE-05', roles: [] }
    ],
    authors: { 'POLICY-1': 'NODE-02', 'POLICY-2': 'NODE-01', 'POLICY-3': 'NODE-04', 'POLICY-4': 'NODE-03', 'POLICY-5': 'NODE-05' }
  };
  return game;
}
const ENACTED = [
  { id: 'POLICY-3', place: 'first', weight: 0.5, points: 15 },
  { id: 'POLICY-2', place: 'second', weight: 0.25, points: 12 },
  { id: 'POLICY-1', place: 'third', weight: 0.25, points: 12 }
];

test('TASK-594: finale role points, author bonus and Catalyst +1 match the hand calculation', () => {
  const game = finaleGame();
  // Role points +2 (1st) / +1 (2nd) / +1 (3rd), cumulative:
  //   artisan (NODE-01): P3 1st +2, P2 2nd +1 = 3
  //   ghost   (NODE-03): P3 1st +2            = 2
  //   lotus   (NODE-02): P1 3rd +1            = 1
  //   assimilator (NODE-04): only on P4, not enacted = 0
  // Author bonus: P3 (1st) was written by NODE-04 -> +1.
  // Catalyst (NODE-05): GDW 25.0 -> 36.0 is an 11 point swing (>= 10) -> +1.
  const awards = game.scoreFinale(ENACTED, 25, 36);
  assert.deepEqual(awards, {
    role: { 'NODE-01': 3, 'NODE-03': 2, 'NODE-02': 1 },
    author: { 'NODE-04': 1 },
    catalyst: { 'NODE-05': 1 }
  });
  assert.deepEqual(game.scores, { 'NODE-01': 3, 'NODE-02': 1, 'NODE-03': 2, 'NODE-04': 1, 'NODE-05': 1 });
  // Ledger entry for the End Screen breakdown.
  assert.equal(game.scoreLedger.at(-1).winner, 'POLICY-3,POLICY-2,POLICY-1');
});

test('TASK-594: the Catalyst gets nothing on a 9.9 swing or a shutdown; the author bonus still pays', () => {
  const small = finaleGame();
  assert.deepEqual(small.scoreFinale(ENACTED, 25, 34.9).catalyst, {});
  assert.equal(small.scores['NODE-05'], 0);
  assert.equal(small.scores['NODE-04'], 1, 'author bonus');

  const shutdown = finaleGame();
  assert.deepEqual(shutdown.scoreFinale(ENACTED, 12, 0).catalyst, {}, '-12 to GDW 0 shuts the Loom down: no Catalyst point');
});

test('TASK-594: an author whose policy places 2nd or 3rd gets no bonus', () => {
  const game = finaleGame();
  const awards = game.scoreFinale([ENACTED[1], ENACTED[0], ENACTED[2]].map((e, i) => ({ ...e, place: ['first', 'second', 'third'][i] })), 25, 25);
  // P2 is now 1st: its author NODE-01 gets the bonus; NODE-04 (P3, now 2nd) does not.
  assert.deepEqual(awards.author, { 'NODE-01': 1 });
  // artisan: P2 1st +2 and P3 2nd +1 = 3; ghost: P3 2nd +1; lotus: P1 3rd +1.
  assert.deepEqual(awards.role, { 'NODE-01': 3, 'NODE-03': 1, 'NODE-02': 1 });
});

test('TASK-594: cycles 1-4 award +1 to every node whose role is tagged on the winning option', () => {
  const game = seatedGame();
  game.cycle = 3;
  game.crisis = { id: 'math', options: { A: { roles: ['artisan', 'ghost'] }, B: { roles: ['lotus'] } } };
  // A wins: artisan (NODE-01) and ghost (NODE-03) +1 each; nobody else.
  assert.deepEqual(game.awardRolePoints('A'), { 'NODE-01': 1, 'NODE-03': 1 });
  // B wins next: lotus (NODE-02) +1.
  assert.deepEqual(game.awardRolePoints('B'), { 'NODE-02': 1 });
  assert.deepEqual(game.scores, { 'NODE-01': 1, 'NODE-02': 1, 'NODE-03': 1, 'NODE-04': 0, 'NODE-05': 0 });
});
