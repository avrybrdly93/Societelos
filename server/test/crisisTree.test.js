'use strict';

// The crisis tree (data/crises.json + selectCrisis), vote scoring
// (server/scoring.js scoreVote) and narration-paced INCIDENT.

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const scoring = require('../scoring');
const { GameState, NODE_IDS } = engine;

const data = engine.loadGameData();
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };

/** The crisis ids a game meets for a root and four A/B decisions, plus the finale. */
function walk(root, votes) {
  const v = {};
  const used = [];
  let world = null;
  for (let cycle = 1; cycle <= 4; cycle++) {
    const c = engine.selectCrisis(data.crises, cycle, world, data.roles, false, { root, votes: v, used });
    used.push(c.id);
    v[cycle] = votes[cycle - 1];
    if (cycle === 2) world = v[1] + v[2];
  }
  used.push(engine.selectCrisis(data.crises, 5, world, data.roles, true, { root, votes: v, used }).id);
  return used;
}

const ALL_VOTES = Array.from({ length: 16 }, (_, n) => [8, 4, 2, 1].map((b) => ((n & b) ? 'B' : 'A')));

test('crisis tree: every root and every decision path reaches its own five crises', () => {
  const roots = engine.treeRoots(data.crises);
  assert.ok(roots.length >= 2, `several roots for replay variety: ${roots}`);
  const paths = new Set();
  for (const root of roots) {
    for (const votes of ALL_VOTES) {
      const ids = walk(root, votes);
      assert.equal(new Set(ids).size, 5, `${root} ${votes.join('')}: no crisis repeats`);
      paths.add(ids.slice(0, 4).join('>'));
    }
  }
  // Decisions 1-3 pick the crises of cycles 2-4 (decision 4 leads into the world's finale).
  assert.equal(paths.size, roots.length * 8, 'each root has 8 distinct cycle 1-4 paths');
});

test('crisis tree: a branch follows the decision that opened it', () => {
  for (const root of engine.treeRoots(data.crises)) {
    // Cycle 2 is always "Who Holds the Off-Switch?", whatever cycle 1 decided.
    const [, afterA] = walk(root, ['A', 'A', 'A', 'A']);
    const [, afterB] = walk(root, ['B', 'A', 'A', 'A']);
    assert.equal(afterA, 'fixed-2-offswitch', `${root}: cycle 2 is the off-switch policy`);
    assert.equal(afterB, 'fixed-2-offswitch', `${root}: cycle 2 is the off-switch policy`);
  }
  for (const world of ['AA', 'AB', 'BA', 'BB']) {
    const c4 = (v3) => walk('ownership', [world[0], world[1], v3, 'A'])[3];
    assert.notEqual(c4('A'), c4('B'), `${world}: cycle 4 depends on cycle 3`);
    for (const v3 of ['A', 'B']) assert.ok(c4(v3).startsWith(world.toLowerCase()), `${world} stays in its world`);
  }
});

test('crisis tree: the root is drawn from the game id (replayable) and recorded with the path', () => {
  const roots = new Set();
  for (let i = 0; i < 24; i++) {
    const game = quiet(() => new GameState({ roomCode: 'TREE' }));
    game.gameId = `tree-seed-${i}`;
    quiet(() => game.startCycle(1));
    roots.add(game.treeRoot);
    const again = quiet(() => new GameState({ roomCode: 'TREE' }));
    again.gameId = game.gameId;
    quiet(() => again.startCycle(1));
    assert.equal(again.treeRoot, game.treeRoot, 'same seed, same root');
  }
  assert.deepEqual([...roots].sort(), engine.treeRoots(data.crises).sort(), 'every root turns up');

  const game = quiet(() => new GameState({ roomCode: 'TREE' }));
  game.fixedRoot = 'factory';
  quiet(() => { game.startCycle(1); game.startIncidentPhase(); });
  game.clearPhaseTimer();
  assert.equal(game.crisis.id, 'fixed-1-factory');
  assert.deepEqual(game.crisisPath, [{ cycle: 1, id: 'fixed-1-factory' }]);
});

test('scoring: agenda vote pays whether or not it passes; the bonus needs it to pass', () => {
  const character = { ideas: { purpose: 0, connection: 0, health: 0, trust: 0, fairness: 1, autonomy: 1 } };
  const options = {
    A: { purpose: 0, connection: 0, health: 0.2, trust: 0, fairness: 0.8, autonomy: 0.6 }, // on agenda
    B: { purpose: 0, connection: 0, health: 0.6, trust: 0.3, fairness: -0.6, autonomy: -0.5 }
  };
  assert.equal(scoring.agendaOption(character, options.A, options.B), 'A');
  const neutral = { satisfactionDelta: 0, approvalShare: 0.5 };
  const wonWithAgenda = scoring.scoreVote(character, options, { ...neutral, vote: 'A', winner: 'A' });
  const lostWithAgenda = scoring.scoreVote(character, options, { ...neutral, vote: 'A', winner: 'B' });
  const againstAgenda = scoring.scoreVote(character, options, { ...neutral, vote: 'B', winner: 'B' });
  const noVote = scoring.scoreVote(character, options, { ...neutral, vote: null, winner: 'A' });
  assert.equal(wonWithAgenda.vote, scoring.VOTE_POINTS);
  assert.equal(wonWithAgenda.passed, scoring.PASSED_POINTS);
  assert.equal(lostWithAgenda.vote, scoring.VOTE_POINTS, 'the agenda vote counts even when it loses');
  assert.equal(lostWithAgenda.passed, 0);
  assert.equal(againstAgenda.vote, scoring.OFF_AGENDA_VOTE_POINTS);
  assert.equal(noVote.vote, 0);
  assert.equal(noVote.passed, scoring.PASSED_POINTS, 'the policy passed in their direction anyway');
  assert.ok(wonWithAgenda.points > lostWithAgenda.points && lostWithAgenda.points > againstAgenda.points);
  assert.ok(wonWithAgenda.points <= scoring.MAX_ROUND_POINTS);
  assert.equal(scoring.scoreVote(character, options, { ...neutral, vote: 'A', winner: 'A', shutdown: true }).points, 0);
});

test('scoring: a round scores each councilperson on their own vote', () => {
  const game = quiet(() => new GameState({ roomCode: 'VOTE' }));
  quiet(() => NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); }));
  game.fixedRoot = 'ownership';
  quiet(() => { game.startRoleAssignmentPhase(); game.startCycle(1); game.startIncidentPhase(); });
  game.clearPhaseTimer();
  const fx = { A: game.effectsFor('A'), B: game.effectsFor('B') };
  const node = NODE_IDS[0];
  const agenda = scoring.agendaOption(game.roleAssignment[node], fx.A, fx.B);
  const mine = agenda === 'B' ? 'B' : 'A';
  game.votes = Object.fromEntries(NODE_IDS.map((n) => [n, { choice: n === node ? mine : (mine === 'A' ? 'B' : 'A'), override: false }]));
  const awards = game.awardRoundPoints(mine === 'A' ? 'B' : 'A', fx[mine === 'A' ? 'B' : 'A'], 25, 26, { share: 0.5, approve: 250, total: 500 });
  assert.equal(awards[node].vote, scoring.VOTE_POINTS, 'voted with the agenda and lost: still 50');
  const update = game.scoreUpdatesFor(awards).find((u) => u.node === node);
  assert.equal(update.vote, scoring.VOTE_POINTS);
  assert.equal(update.votedWithAgenda, true);
});

test('INCIDENT waits for the Loom to finish reading, then moves on after a beat', () => {
  const game = quiet(() => new GameState({ roomCode: 'READ' }));
  quiet(() => NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); }));
  game.fixedRoot = 'ownership';
  quiet(() => { game.startCycle(1); game.startIncidentPhase(); });
  const words = `${game.crisis.title} ${game.crisis.incident} ${game.crisis.loomIntro}`.split(/\s+/).length;
  const window = game.endsAt - Date.now();
  assert.ok(window > words * 400, `room to read ${words} words aloud (${window} ms)`);
  assert.deepEqual(game.narrationDone('DEBATE', 1), { ok: false, reason: 'WRONG_PHASE' });
  assert.deepEqual(game.narrationDone('INCIDENT', 2), { ok: false, reason: 'WRONG_CYCLE' });
  const res = game.narrationDone('INCIDENT', 1);
  assert.equal(res.ok, true);
  assert.ok(res.endsAt - Date.now() <= 1600, 'a short beat, then DEBATE');
  game.clearPhaseTimer();
});

test('DEBATE and VOTE carry the round countdown (3 minutes by default)', () => {
  const game = quiet(() => new GameState({ roomCode: 'ROUND' }));
  const phases = [];
  game.on('phase', (p) => phases.push(p));
  quiet(() => NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); }));
  quiet(() => { game.startCycle(1); game.startIncidentPhase(); game.startDebatePhase(); game.startBlindVotePhase(); });
  game.clearPhaseTimer();
  const [debate, vote] = phases.filter((p) => p.phase === 'DEBATE' || p.phase === 'VOTE');
  assert.equal(debate.round.totalMs, 180000);
  assert.ok(Math.abs(debate.round.endsAt - debate.endsAt - game.durations.VOTE) < 100, 'the round ends when the vote does');
  assert.equal(vote.round.totalMs, 180000);
  assert.ok(Math.abs(vote.round.endsAt - vote.endsAt) < 100);
});
