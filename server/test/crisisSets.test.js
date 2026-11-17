'use strict';

// Crisis sets: each world has more than one cycle 3-4 pair (AA1, AA2, ...),
// picked per game (or forced by the host) so demos vary. The write-in
// finale is shared by every set.

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../gameEngine');
const { playGame } = require('./playGame');

const data = engine.loadGameData();
const WORLDS = ['AA', 'AB', 'BA', 'BB'];

const SET2 = {
  AA: ['aa-robot-art', 'aa-curriculum-revolt'],
  AB: ['ab-curated-bonds', 'ab-memory-edit'],
  BA: ['ba-private-security', 'ba-media-monopoly'],
  BB: ['bb-luxury-lottery', 'bb-biometric-tollways']
};
const SET1 = {
  AA: ['aa-purpose-drift', 'aa-lost-knowledge'],
  AB: ['ab-the-pods', 'ab-mood-dial'],
  BA: ['ba-shadow-elite', 'ba-status-wars'],
  BB: ['bb-scroll-extinction', 'bb-the-unplugged']
};

test('every world has crisis sets 1 and 2', () => {
  for (const w of WORLDS) assert.deepEqual(engine.worldSets(data.crises, w), [1, 2], w);
});

test('selectCrisis plays the chosen set in cycles 3-4 and the shared finale in cycle 5', () => {
  for (const w of WORLDS) {
    for (const [set, ids] of [[1, SET1[w]], [2, SET2[w]]]) {
      const c3 = engine.selectCrisis(data.crises, 3, w, data.roles, false, set);
      const c4 = engine.selectCrisis(data.crises, 4, w, data.roles, false, set);
      assert.deepEqual([c3.id, c4.id], ids, `${w}${set}`);
      const finale = engine.selectCrisis(data.crises, 5, w, data.roles, true, set);
      assert.equal(finale.id, data.crises.worlds[w].finale, `${w}${set} finale`);
      assert.equal(finale.mode, 'writein');
    }
  }
});

test('blitz cycles past a set borrow the other set, so nothing repeats early', () => {
  const ids = [3, 4, 5, 6].map((cy) => engine.selectCrisis(data.crises, cy, 'AA', data.roles, false, 2).id);
  assert.deepEqual(ids, [...SET2.AA, ...SET1.AA]);
  const ids1 = [3, 4, 5, 6].map((cy) => engine.selectCrisis(data.crises, cy, 'AA', data.roles, false, 1).id);
  assert.deepEqual(ids1, [...SET1.AA, ...SET2.AA]);
});

test('host:config crisisSet accepts random or a set number, and the pick follows it', () => {
  const game = new engine.GameState({ roomCode: 'SETS' });
  assert.equal(game.getConfig().crisisSet, 'random');
  assert.deepEqual(game.configure({ crisisSet: 0 }), { ok: false, reason: 'BAD_CRISIS_SET' });
  assert.deepEqual(game.configure({ crisisSet: 'two' }), { ok: false, reason: 'BAD_CRISIS_SET' });
  assert.equal(game.configure({ crisisSet: 2 }).config.crisisSet, 2);
  assert.equal(game.pickWorldSet('BA'), 2);
  // A set the world does not have falls back to set 1.
  game.configure({ crisisSet: 7 });
  assert.equal(game.pickWorldSet('BA'), 1);
  // Random: deterministic per game id, and both sets turn up across games.
  game.configure({ crisisSet: 'random' });
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    game.gameId = `variety-${i}`;
    const a = game.pickWorldSet('AB');
    assert.equal(game.pickWorldSet('AB'), a, 'same game id, same set');
    seen.add(a);
  }
  assert.deepEqual([...seen].sort(), [1, 2]);
});

test('headless game forced to set 2 plays AA2 and reveals it as AA2', async () => {
  const out = await playGame({ gameId: 'sets-aa2', world: 'AA', crisisSet: 2 });
  try {
    assert.equal(out.game.worldKey, 'AA');
    assert.equal(out.game.worldSet, 2);
    assert.equal(out.reveals[0].variant, 'AA2');
    const incidents = out.phases.filter((p) => /^[345]:INCIDENT$/.test(p));
    assert.equal(incidents.length, 3);
    const played = out.payloads
      .filter((p) => p.phase === 'INCIDENT' && p.crisis && p.cycle >= 3)
      .map((p) => p.crisis.id)
      .filter((id, i, a) => id !== a[i - 1]);
    assert.deepEqual(played, [...SET2.AA, data.crises.worlds.AA.finale]);
  } finally {
    if (out.restoreEnv) out.restoreEnv();
  }
});
