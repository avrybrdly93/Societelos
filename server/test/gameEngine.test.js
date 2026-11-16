'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');

const { GameState, NODE_IDS } = engine;

/** A seated 5-player game with the cycle's crisis loaded and voting open. */
function votingGame({ cycle = 1, voteHistory = {} } = {}) {
  const game = new GameState({ roomCode: 'TEST' });
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.forEach((node, i) => game.addPlayer(`socket-${i}`, `Student ${i + 1}`));
    game.startCycle(1);
    game.cycle = cycle;
    game.voteHistory = { ...voteHistory };
    game.crisis = engine.selectCrisis(game.data.crises, cycle, null, game.data.roles);
  } finally {
    console.log = log;
  }
  game.phase = engine.PHASES.VOTE;
  game.votingOpen = true;
  return game;
}

/** Cast `choices` ([choice, override?] per node in NODE_IDS order). */
function cast(game, choices) {
  choices.forEach(([choice, override], i) => {
    const res = game.castVote(NODE_IDS[i], choice, !!override);
    assert.ok(res.ok, `vote ${i} rejected: ${res.reason}`);
  });
}

test('weighted vote count with no Overrides: each vote counts 1', () => {
  const game = votingGame();
  cast(game, [['A'], ['A'], ['A'], ['B'], ['B']]);
  const { totals, winner, tie } = game.tallyVotes();
  assert.deepEqual(totals, { A: 3, B: 2 });
  assert.equal(winner, 'A');
  assert.equal(tie, false);
});

test('weighted vote count with one Override: it counts 2 and can flip the result', () => {
  const game = votingGame();
  cast(game, [['A'], ['A'], ['B', true], ['B'], ['B']]);
  const { totals, winner } = game.tallyVotes();
  assert.deepEqual(totals, { A: 2, B: 4 });
  assert.equal(winner, 'B');

  const tied = votingGame();
  cast(tied, [['A', true], ['A'], ['B'], ['B'], ['B']]);
  assert.deepEqual(tied.tallyVotes().totals, { A: 3, B: 3 });
  assert.equal(tied.tallyVotes().tie, true);
});

test('weighted vote count with multiple Overrides', () => {
  const game = votingGame();
  cast(game, [['A', true], ['A', true], ['B', true], ['B'], ['B']]);
  assert.deepEqual(game.tallyVotes().totals, { A: 4, B: 4 });

  const all = votingGame();
  cast(all, [['A', true], ['B', true], ['B', true], ['B', true], ['B', true]]);
  assert.deepEqual(all.tallyVotes().totals, { A: 2, B: 8 });
});

test('an Override can only be spent once per game', () => {
  const game = votingGame();
  assert.equal(game.overrideAvailable('NODE-01'), true);
  assert.ok(game.castVote('NODE-01', 'A', true).ok);
  assert.equal(game.overrideAvailable('NODE-01'), false);
  // Next cycle: a second Override is rejected, a normal vote is accepted.
  game.votes = {};
  assert.deepEqual(game.castVote('NODE-01', 'B', true), { ok: false, reason: 'OVERRIDE_SPENT' });
  assert.ok(game.castVote('NODE-01', 'B', false).ok);
  assert.equal(game.votes['NODE-01'].override, false);
});
