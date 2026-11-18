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
