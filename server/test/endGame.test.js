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
    assert.equal(end.grade, engine.gradeFor(end.finalGdw));
    assert.equal(end.gradeText, engine.GRADE_TEXT[end.grade]);
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
    assert.equal(emitted.grade, 'SHUTDOWN');
    assert.equal(emitted.gradeText, 'The Loom has shut down');
    assert.equal(emitted.worldKey, null);
    game.resetGame();
    assert.equal(game.endData, null);
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});

// TASK-602 ------------------------------------------------------------------

test('gradeFor maps final GDW to SHUTDOWN / Fragile / Stable / Thriving', () => {
  assert.equal(engine.gradeFor(0), 'SHUTDOWN');
  assert.equal(engine.gradeFor(12.3), 'Fragile');
  assert.equal(engine.gradeFor(47), 'Stable');
  assert.equal(engine.gradeFor(81.4), 'Thriving');
  assert.equal(engine.gradeFor(NaN), 'SHUTDOWN', 'a broken number never reads as a success');
});

// TASK-603 ------------------------------------------------------------------

test('game:end gdwHistory holds the starting 25 plus all 60 realized months, with cycle markers', async () => {
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    const out = await playGame({ gameId: 'enddata-history', world: 'AA' });
    const { gdwHistory, cycleMarkers } = out.gameEnd;
    assert.equal(gdwHistory.length, 61);
    assert.equal(gdwHistory[0], 25);
    assert.equal(gdwHistory[60], out.gameEnd.finalGdw);
    assert.deepEqual(cycleMarkers.map((m) => m.cycle), [1, 2, 3, 4, 5]);
    assert.deepEqual(cycleMarkers.map((m) => m.index), [12, 24, 36, 48, 60]);
    // Each marker's GDW is the realized GDW the resolution showed for that cycle.
    assert.deepEqual(cycleMarkers.map((m) => m.gdw), out.resolutions.map((r) => r.gdw));
    assert.notEqual(gdwHistory, out.game.gdwHistory, 'a copy, not the live array');
  });
});

test('on a shutdown, gdwHistory stops at the month GDW hit 0', () => {
  const game = new engine.GameState({ roomCode: 'ENDH' });
  game.gdwHistory = [25, ...Array.from({ length: 12 }, (_, i) => 24 - i), 9, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  game.cycleMarkers = [{ cycle: 1, index: 12, gdw: 13 }, { cycle: 2, index: 24, gdw: 0 }];
  const { gdwHistory, cycleMarkers } = game.endGdwHistory();
  assert.equal(gdwHistory.length, 16, 'start + 12 months + 3 months to the shutdown');
  assert.equal(gdwHistory.at(-1), 0);
  assert.deepEqual(cycleMarkers, [{ cycle: 1, index: 12, gdw: 13 }, { cycle: 2, index: 15, gdw: 0 }]);
});

// TASK-604 ------------------------------------------------------------------

test('game:end roles reveal maps NODE-01..05 to name, secret role and per-cycle scores', async () => {
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    const out = await playGame({ gameId: 'enddata-roles', world: 'AB' });
    const { roles, scores } = out.gameEnd;
    assert.deepEqual(roles.map((r) => r.node), NODE_IDS);
    assert.deepEqual(roles.map((r) => r.name), ['P0', 'P1', 'P2', 'P3', 'P4']);
    assert.deepEqual(roles.map((r) => r.role.key).sort(), ['artisan', 'assimilator', 'catalyst', 'ghost', 'lotus']);
    for (const r of roles) {
      assert.equal(r.role.key, out.roles[r.node], `${r.node} reveals the role it was dealt`);
      assert.ok(r.role.name && r.role.icon, 'role title and icon');
      assert.deepEqual(r.perCycle.map((c) => c.cycle), [1, 2, 3, 4, 5]);
      const sum = r.perCycle.reduce((t, c) => t + c.role + c.catalyst + c.author, 0);
      assert.equal(sum, r.total, `${r.node} breakdown adds up`);
      assert.equal(r.total, scores[r.node]);
    }
  });
});
