'use strict';

// TASK-774: host:playAgain starts Game #2 cleanly with zero leftover state
// from Game #1. (The browser side, projector and phone screens, is
// npm run e2e:play-again.)

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../gameEngine');
const { playGame, okModeration, withLoom } = require('./playGame');

// Fields that legitimately differ from a brand-new room: identity, clocks,
// per-room config and the timer generation counter.
const EXPECTED_DIFF = new Set(['gameId', 'createdAt', 'durations', 'timerToken', 'players']);
// (players is checked field by field below: same seats, new state.)

const norm = (v) => JSON.stringify(v === undefined ? null : v, (k, x) => (x instanceof Set ? [...x] : x instanceof Map ? [...x] : x));

function freshRoom() {
  const log = console.log;
  console.log = () => {};
  try {
    const g = new engine.GameState({ roomCode: 'PLAY' });
    engine.NODE_IDS.forEach((n, i) => g.addPlayer(`s${i}`, `P${i}`));
    // A fresh room's lazily created fields (undefined until first use) are
    // compared in their reset form; anything Game #1 left behind still shows.
    g.resetGame();
    return g;
  } finally {
    console.log = log;
  }
}

test('after a full write-in game, playAgain({ keepPlayers }) leaves the room identical to a fresh one', async () => {
  const out = await withLoom({ moderate: async (subs) => okModeration(subs) }, () => playGame({ gameId: 'play-again-774', world: 'BA', keepRoom: true }));
  const game = out.game;
  assert.equal(game.phase, 'END');
  assert.ok(game.scoreLedger.length === 5 && game.finale && game.endData, 'Game #1 left plenty of state behind to clear');
  const log = console.log;
  console.log = () => {};
  const res = game.playAgain({ keepPlayers: true });
  console.log = log;
  assert.equal(res.ok, true);
  assert.notEqual(res.gameId, 'play-again-774', 'a new game id');
  const fresh = freshRoom();
  const keys = new Set([...Object.keys(game), ...Object.keys(fresh)].filter((k) => !k.startsWith('_')));
  for (const k of keys) {
    if (EXPECTED_DIFF.has(k)) continue;
    assert.equal(norm(game[k]), norm(fresh[k]), `leftover state in "${k}"`);
  }
  // Seats: the same five, unready, roleless, no score or Override carried over.
  for (const node of engine.NODE_IDS) {
    const p = game.players[node];
    assert.ok(p, `${node} still seated`);
    assert.equal(p.role, null);
    assert.equal(p.ready, false, 'players ready up again for Game #2');
    assert.equal(game.scores[node], 0);
    assert.equal(game.overridesUsed[node], false);
  }
  game.stop();
});

test('Game #2 in the reused room plays exactly like a fresh room on the same seed', async () => {
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    const first = await playGame({ gameId: 'play-again-774-g1', world: 'AA', keepRoom: true });
    const log = console.log;
    console.log = () => {};
    first.game.playAgain({ keepPlayers: true });
    console.log = log;
    const reused = await playGame({ game: first.game, gameId: 'play-again-774-g2', world: 'BB' });
    const fresh = await playGame({ gameId: 'play-again-774-g2', world: 'BB' });
    assert.equal(reused.end.phase, 'END');
    assert.deepEqual(reused.phases, fresh.phases, 'same phase sequence');
    assert.deepEqual(reused.game.gdwHistory, fresh.game.gdwHistory, 'same GDW line');
    assert.deepEqual(reused.roles, fresh.roles, 'same role deal');
    assert.deepEqual(reused.game.scores, fresh.game.scores, 'same scores (nothing carried over)');
    assert.deepEqual(reused.game.voteHistory, fresh.game.voteHistory);
    assert.equal(reused.gameEnd.grade, fresh.gameEnd.grade);
    assert.deepEqual(reused.gameEnd.winner, fresh.gameEnd.winner);
  });
});
