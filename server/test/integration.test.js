'use strict';

// Integrated-build checks: the real engine with the real simulation, Loom
// (offline fallback), content and client modules, driven through whole games.

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const { GameState, NODE_IDS } = engine;

/**
 * Play cycles 1-4 with real phase timers shrunk to ~10 ms. `voteFor(cycle, i)`
 * returns [choice, override?] for node i. Resolves with everything emitted.
 */
function playFourCycles({ gameId = 'integration01', voteFor, phaseSeconds = {} } = {}) {
  const saved = { fast: process.env.FAST_TIMERS, secs: process.env.FAST_TIMER_SECONDS, key: process.env.GEMINI_API_KEY };
  process.env.FAST_TIMERS = 'true';
  process.env.FAST_TIMER_SECONDS = '0.01';
  delete process.env.GEMINI_API_KEY;
  const game = new GameState({ roomCode: 'INTG', phaseSeconds });
  for (const [k, v] of [['FAST_TIMERS', saved.fast], ['FAST_TIMER_SECONDS', saved.secs], ['GEMINI_API_KEY', saved.key]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  game.gameId = gameId;
  const out = { game, phases: [], resolutions: [], reveals: [], scores: [], roles: {} };
  const log = console.log;
  console.log = () => {};
  NODE_IDS.forEach((node, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(node, true); });
  game.on('role:assigned', ({ node, role }) => { out.roles[node] = role.key; });
  game.on('resolution', (r) => out.resolutions.push(r));
  game.on('world:reveal', (w) => out.reveals.push(w));
  game.on('score:update', (s) => out.scores.push(s));
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => { game.clearPhaseTimer(); console.log = log; reject(new Error(`stalled: ${out.phases.slice(-3)}`)); }, 15000);
    game.on('phase', (p) => {
      out.phases.push(p);
      if (p.phase === 'VOTE') NODE_IDS.forEach((n, i) => { const [c, o] = voteFor(p.cycle, i); game.castVote(n, c, !!o); });
      if (p.cycle === 5 || p.phase === 'END') {
        clearTimeout(guard);
        game.clearPhaseTimer();
        console.log = log;
        resolve(out);
      }
    });
    game.startIntroPhase();
  });
}

test('integration: gameEngine + server/sim (real simulate, state carried across cycles)', async () => {
  const out = await playFourCycles({ voteFor: (cycle, i) => [i < 3 ? 'A' : 'B'] });
  assert.equal(out.resolutions.length, 4);
  let gdw = engine.STARTING_GDW;
  for (const r of out.resolutions) {
    assert.equal(r.result.previousGdw, gdw, 'each cycle starts where the last ended');
    assert.equal(r.gdw, Math.round(r.realized.finalGdw * 10) / 10, 'GDW comes from the realized run');
    assert.ok(!r.realized.gdw.stub && r.forecast.median.length === 13);
    gdw = r.gdw;
  }
  assert.equal(out.game.gdwHistory.length, 1 + 4 * 12);
  assert.ok(out.game.simState && out.game.simState.traits.length === 120, '20 cohorts x 6 traits');
});

test('integration: gameEngine + server/loom.js (offline narration on every resolution)', async () => {
  const citizens = require('../../data/citizens.json');
  const out = await playFourCycles({ gameId: 'integration02', voteFor: (cycle) => [cycle === 2 ? 'B' : 'A'] });
  for (const r of out.resolutions) {
    assert.ok(typeof r.loomLine === 'string' && r.loomLine.length > 0 && r.loomLine.length <= 200);
    assert.ok(r.messages.length >= 1 && r.messages.length <= 10);
    const ids = r.messages.map((m) => m.citizenId);
    assert.equal(new Set(ids).size, ids.length, 'distinct citizens');
    for (const m of r.messages) {
      const c = citizens.find((x) => x.id === m.citizenId);
      assert.ok(c, m.citizenId);
      assert.equal(m.name, c.name, 'engine enriches reactions with the citizen card');
      assert.ok(m.text.length <= 140);
    }
  }
});

test('integration: data/crises.json worlds AA and AB drive cycles 3-4', () => {
  const data = engine.loadGameData();
  const expected = { AA: ['aa-purpose-drift', 'aa-lost-knowledge'], AB: ['ab-the-pods', 'ab-mood-dial'] };
  for (const [world, ids] of Object.entries(expected)) {
    [3, 4].forEach((cycle, i) => {
      const crisis = engine.selectCrisis(data.crises, cycle, world, data.roles);
      assert.equal(crisis.id, ids[i]);
      assert.equal(crisis.mode, 'binary');
      assert.ok(crisis.incident && crisis.loomIntro, `${crisis.id} has incident and Loom intro`);
      assert.deepEqual(Object.keys(crisis.intel).sort(), ['artisan', 'assimilator', 'catalyst', 'ghost', 'lotus'], `${crisis.id} intel`);
      for (const key of ['A', 'B']) {
        const o = crisis.options[key];
        assert.ok(o.name && o.text && o.roles.length >= 1, `${crisis.id} ${key}`);
        assert.equal(Object.keys(o.effects).length, 6);
      }
    });
  }
});

/** Assertions shared by the AA and AB playthroughs. */
function checkWorldRun(out, world, crisisIds) {
  const { game } = out;
  assert.equal(game.worldKey, world);
  assert.equal(out.reveals.length, 1);
  assert.equal(out.reveals[0].worldKey, world);
  const incidents = out.phases.filter((p) => p.phase === 'INCIDENT').map((p) => `${p.cycle}:${p.crisis && p.crisis.id}`);
  assert.deepEqual(incidents.slice(2, 4), [`3:${crisisIds[0]}`, `4:${crisisIds[1]}`]);
  assert.equal(out.resolutions.length, 4);
  assert.ok(out.phases.findIndex((p) => p.phase === 'WORLD_REVEAL') > out.phases.findIndex((p) => p.cycle === 2 && p.phase === 'RESOLUTION'));
}

test('integration: headless 4-cycle playthrough on the AA (Commonwealth) branch', async () => {
  const out = await playFourCycles({ gameId: 'playthroughAA', voteFor: () => ['A'] });
  checkWorldRun(out, 'AA', ['aa-purpose-drift', 'aa-lost-knowledge']);
  assert.equal(out.game.volatility, 1.5, 'The Assembly (2A) made the rest of the game volatile');
});

test('integration: headless 4-cycle playthrough on the AB (Benevolent Machine) branch', async () => {
  const out = await playFourCycles({ gameId: 'playthroughAB', voteFor: (cycle) => [cycle === 2 ? 'B' : 'A'] });
  checkWorldRun(out, 'AB', ['ab-the-pods', 'ab-mood-dial']);
  assert.equal(out.game.volatility, 1, 'Delegated Control keeps normal volatility');
  // Crisis 2B after 1A: the Loom governs, with the assimilator tag.
  assert.deepEqual(out.resolutions[1].result.governance, { holder: 'loom', line: 'The Loom will govern on your behalf.' });
});
