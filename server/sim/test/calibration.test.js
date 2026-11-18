'use strict';

// TASK-737: the fixed crises' forecast medians stay on their MVP targets
// (1A -5, 1B +10, 2A -5, 2B +5 after either Cycle 1 result), +/- 1.5 GDW,
// with the shipped data/sim.json and data/crises.json.

const test = require('node:test');
const assert = require('node:assert/strict');

const { calibrateFixed } = require('../calibrate');
const simConfig = require('../../../data/sim.json');
const crises = require('../../../data/crises.json');

test('fixed crisis forecast medians land within 1.5 GDW of their targets', () => {
  const rows = calibrateFixed(simConfig, crises);
  const expected = { '1A': -5, '1B': 10, '2A': -5, '2B (after 1A)': 5, '2B (after 1B)': 5 };
  assert.deepEqual(rows.map((r) => r.option).sort(), Object.keys(expected).sort());
  for (const r of rows) {
    assert.equal(r.target, expected[r.option], `${r.option} target in crises.json`);
    assert.ok(Math.abs(r.median - r.target) <= 1.5, `${r.option}: median ${r.median.toFixed(2)} vs target ${r.target}`);
  }
});

// TASK-738: from each world's median Cycle 2 state, no single Cycle 3 or 4
// binary choice (Cycle 4 after either Cycle 3 result) makes collapse
// unavoidable: every forecast keeps P(collapse) well below 100%.
test('no Cycle 3-4 binary choice forces collapse from a median starting state', () => {
  const { simulate } = require('..');
  const { worldStartState, RUNS, SEED } = require('../calibrate');
  for (const world of ['AA', 'AB', 'BA', 'BB']) {
    const { state, volatility } = worldStartState(simConfig, crises, world);
    const c3 = crises.crises.find((c) => c.world === world && c.cycle === 3 && c.mode === 'binary');
    const c4 = crises.crises.find((c) => c.world === world && c.cycle === 4 && c.mode === 'binary');
    for (const k3 of ['A', 'B']) {
      const r3 = simulate(state, c3.options[k3].effects, { runs: RUNS, seed: SEED, volatility });
      assert.ok(r3.forecast.pCollapse < 0.5, `${world} C3 ${k3}: P(collapse) ${r3.forecast.pCollapse}`);
      for (const k4 of ['A', 'B']) {
        const r4 = simulate(r3.finalState, c4.options[k4].effects, { runs: RUNS, seed: SEED + 1, volatility });
        assert.ok(r4.forecast.pCollapse < 0.5, `${world} C4 ${k4} after ${k3}: P(collapse) ${r4.forecast.pCollapse}`);
      }
    }
  }
});

// TASK-751: the stretch-goal boundary documented at the top of
// server/sim/index.js is exactly what the engine uses, so an agent-based
// model can replace the module without touching server/gameEngine.js.
test('server/sim exports the documented engine boundary, and the engine uses nothing else', () => {
  const fs = require('fs');
  const path = require('path');
  const sim = require('..');
  const contract = ['createInitialState', 'simulate', 'getForecastMedian', 'computeGDW', 'citizenMoods', 'closingCitizen'];
  for (const fn of contract) assert.equal(typeof sim[fn], 'function', `sim.${fn}`);
  const doc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(doc, /STRETCH GOAL BOUNDARY/);
  for (const fn of contract) assert.ok(doc.slice(0, doc.indexOf('@typedef')).includes(fn), `${fn} documented in the boundary`);
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'gameEngine.js'), 'utf8');
  const used = new Set([...engine.matchAll(/\bsim\.([a-zA-Z]+)\s*\(/g)].map((m) => m[1]));
  for (const fn of used) assert.ok(contract.includes(fn), `engine calls sim.${fn}, which is not in the documented boundary`);
  // The result shape the engine reads.
  const r = sim.simulate(sim.createInitialState(simConfig), { purpose: 0.2, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: -0.1 }, { runs: 20, seed: 7 });
  for (const k of ['forecast', 'realized', 'finalState', 'summary']) assert.ok(r[k], k);
  assert.equal(r.realized.districts.length, 13);
  assert.ok(Array.isArray(r.summary.topMoves) && Array.isArray(r.summary.shocks));
});
