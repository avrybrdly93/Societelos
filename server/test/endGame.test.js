'use strict';

// Thursday End Screen data: the END compiler and the game:end payload.

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const { NODE_IDS } = engine;
const { playGame, okModeration, withLoom } = require('./playGame');

// TASK-601 ------------------------------------------------------------------

test('END compiles the End Screen data once, after Cycle 5, and emits game:end', async () => {
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    const out = await playGame({ gameId: 'enddata-01', world: 'BB' });
    const end = out.gameEnd;
    assert.ok(end, 'game:end emitted');
    assert.equal(out.game.endData, end, 'stored on the game for late or reconnecting hosts');
    assert.equal(end.gameId, 'enddata-01');
    assert.equal(end.cyclesPlayed, 5);
    assert.equal(end.finalGdw, out.game.gdw);
    assert.equal(end.shutdown, false);
    assert.equal(end.worldKey, 'BB');
    assert.equal(end.worldName, 'The Gilded Cage');
    assert.deepEqual(Object.keys(end.scores), NODE_IDS);
    for (const node of NODE_IDS) assert.equal(end.scores[node], out.game.scores[node]);
    assert.ok(end.closingMessage && end.closingMessage.text, 'closing citizen line');
  });
});

test('END data is compiled early when realized GDW hits 0, and resetGame clears it', async () => {
  const game = new engine.GameState({ roomCode: 'ENDX' });
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.forEach((n, i) => game.addPlayer(`s${i}`, `P${i}`));
    game.cycle = 2;
    game.worldKey = null;
    game.gdw = 0;
    game.ending = 'shutdown';
    let emitted = null;
    game.on('game:end', (d) => { emitted = d; });
    game.startEndPhase();
    assert.equal(game.phase, 'END');
    assert.equal(emitted.shutdown, true);
    assert.equal(emitted.cyclesPlayed, 2);
    assert.equal(emitted.finalGdw, 0);
    assert.equal(emitted.worldKey, null);
    game.resetGame();
    assert.equal(game.endData, null);
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});
