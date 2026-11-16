'use strict';

// Interface contracts between server/gameEngine.js and the Stream 4 modules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'gameEngine.js'), 'utf8');

test('server/sim/index.js exports everything gameEngine.js calls, with the agreed shapes', () => {
  const sim = require('../sim');
  // The functions the engine uses, each referenced in gameEngine.js and exported here.
  for (const fn of ['simulate', 'createInitialState', 'computeGDW', 'citizenMoods']) {
    assert.ok(new RegExp(`\\bsim\\.${fn}\\b`).test(ENGINE_SRC), `engine uses sim.${fn}`);
    assert.equal(typeof sim[fn], 'function', `sim.${fn} exported`);
  }

  const simConfig = require('../../data/sim.json');
  const state = sim.createInitialState(simConfig);
  assert.equal(sim.computeGDW(state), simConfig.gdw.startingGdw);
  // The engine calls simulate({ gdw, simState }, effects, { runs, seed, volatility }).
  const r = sim.simulate({ gdw: 25, simState: state }, { purpose: 0.2 }, { runs: 20, seed: 1, volatility: 1.5 });
  for (const k of ['median', 'p5', 'p95']) assert.equal(r.forecast[k].length, 13, k);
  assert.equal(typeof r.forecast.pCollapse, 'number');
  assert.equal(typeof r.forecast.pUnrest, 'number');
  assert.equal(r.realized.gdw.length, 13);
  assert.equal(typeof r.realized.finalGdw, 'number');
  assert.equal(r.realized.districts.length, 13);
  assert.ok(Array.isArray(r.realized.shocks));
  assert.ok(r.finalState && r.finalState.traits, 'finalState feeds the next cycle');
  for (const k of ['realizedDelta', 'medianDelta', 'pCollapse', 'pUnrest', 'topMoves', 'shocks']) assert.ok(k in r.summary, `summary.${k}`);
  // Without a sim state the engine still gets the same shape (stub mode).
  const stub = sim.simulate({ gdw: 30 }, {}, { runs: 0, seed: 1 });
  assert.equal(stub.realized.gdw.length, 13);
  // citizenMoods(before, after, citizens) -> [{ id, mood, moodChange, topChange }].
  const moods = sim.citizenMoods(state, r.finalState, require('../../data/citizens.json'));
  assert.equal(moods.length, 10);
  for (const m of moods) assert.ok(typeof m.mood === 'number' && m.topChange && typeof m.topChange.trait === 'string');
});

test('server/loom.js exports the narrate/moderate contract gameEngine.js expects', async () => {
  const loom = require('../loom');
  assert.ok(/\bresolveLoom\(\)\.narrate\(/.test(ENGINE_SRC), 'engine narrates through loom.narrate');
  for (const fn of ['narrate', 'moderate', 'testConnection']) assert.equal(typeof loom[fn], 'function', fn);
  const OFFLINE = { enabled: false, apiKey: '', model: 'x', timeoutMs: 8000 };
  // narrate(context) resolves (never rejects) to { loomLine, messages: [{ citizenId, text }] }.
  const citizens = require('../../data/citizens.json');
  const n = await loom.narrate({ crisis: { title: 'T' }, winningOption: { name: 'P' }, simSummary: { realizedDelta: 2 }, worldKey: null, citizens }, { config: OFFLINE });
  assert.equal(typeof n.loomLine, 'string');
  assert.ok(n.loomLine.length > 0 && n.loomLine.length <= 200);
  for (const m of n.messages) assert.ok(typeof m.citizenId === 'string' && typeof m.text === 'string' && m.text.length <= 140);
  // Even with garbage input.
  const g = await loom.narrate(undefined, { config: OFFLINE });
  assert.equal(typeof g.loomLine, 'string');
  // moderate(submissions, crisis) -> one entry per submission with clamped effects.
  const mod = await loom.moderate([{ node: 'NODE-01', text: 'Every district elects a repair council.' }], { title: 'T' }, { config: OFFLINE });
  assert.equal(mod.length, 1);
  const e = mod[0];
  assert.equal(e.node, 'NODE-01');
  assert.ok(['ok', 'revise', 'reject'].includes(e.status));
  assert.equal(typeof e.cleaned, 'string');
  assert.ok(Array.isArray(e.roles));
  for (const t of ['purpose', 'connection', 'health', 'trust', 'fairness', 'autonomy']) {
    assert.ok(typeof e.effects[t] === 'number' && e.effects[t] >= -1 && e.effects[t] <= 1, t);
  }
});
