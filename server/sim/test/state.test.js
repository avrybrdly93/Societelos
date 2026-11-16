'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { createInitialState, computeGDW } = require('../state');

// Tests may read data/sim.json; the simulation modules themselves never do I/O.
const simConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'sim.json'), 'utf8'));

test('starting state reads exactly GDW 25.0', () => {
  assert.equal(computeGDW(createInitialState(simConfig)), 25);
});

test('computeGDW clamps at 0 when W <= 0.20 and at 100 when W >= 1.00', () => {
  const gdwCfg = simConfig.gdw;
  assert.equal(computeGDW(0.20, gdwCfg), 0);
  assert.equal(computeGDW(0.05, gdwCfg), 0);
  assert.equal(computeGDW(-1, gdwCfg), 0);
  assert.equal(computeGDW(1.0, gdwCfg), 100);
  assert.equal(computeGDW(1.7, gdwCfg), 100);
  assert.equal(computeGDW(0.60, gdwCfg), 50);

  // Same through a real state: all traits 0 -> W = 0 -> GDW 0; all 1 -> GDW 100.
  const low = createInitialState(simConfig);
  low.traits.fill(0);
  assert.equal(computeGDW(low), 0);
  const high = createInitialState(simConfig);
  high.traits.fill(1);
  assert.equal(computeGDW(high), 100);
});

test('data/sim.json passes validateSimConfig, and broken configs are caught', () => {
  const { validateSimConfig } = require('../state');
  assert.deepEqual(validateSimConfig(simConfig), []);
  const broken = JSON.parse(JSON.stringify(simConfig));
  broken.weights.purpose = 0.5;
  broken.districts[0].neighbours.push('D9');
  delete broken.sensitivity['D3:elders'];
  const errors = validateSimConfig(broken);
  assert.ok(errors.some((e) => e.includes('weights')));
  assert.ok(errors.some((e) => e.includes('D9')));
  assert.ok(errors.some((e) => e.includes('D3:elders')));
});
