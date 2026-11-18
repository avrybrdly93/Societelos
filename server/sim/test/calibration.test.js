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
