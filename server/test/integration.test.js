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
