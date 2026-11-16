'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { createInitialState } = require('../state');
const { buildParams, stepMonth, applySpillover, applyNoise, applyShocks } = require('../step');
const { mulberry32 } = require('../prng');

const simConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'sim.json'), 'utf8'));
const TRAITS = simConfig.traits;
const allTraits = (v) => Object.fromEntries(TRAITS.map((t) => [t, v]));

test('stepMonth keeps all 6 traits within [0, 1] under extreme +/-1 effect vectors', () => {
  for (const effects of [allTraits(1), allTraits(-1)]) {
    const state = createInitialState(simConfig);
    // A huge alpha forces the policy shift well past the bounds.
    const params = buildParams(state, { alpha: 10, volatility: 3 });
    const rng = mulberry32(99);
    for (let m = 1; m <= 12; m++) {
      stepMonth(state, effects, m, params, rng);
      for (const v of state.traits) assert.ok(v >= 0 && v <= 1, `trait out of range: ${v}`);
    }
  }
});
