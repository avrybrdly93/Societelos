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

test('neighbour spillover moves D1 traits toward the average of D2 and D3', () => {
  const state = createInitialState(simConfig);
  const K = TRAITS.length;
  const idx = (key) => state.cohorts.findIndex((c) => c.key === key);
  // Make the gap obvious: D1 workers low, D2 and D3 workers high.
  const d1 = idx('D1:workers');
  const d2 = idx('D2:workers');
  const d3 = idx('D3:workers');
  for (let k = 0; k < K; k++) {
    state.traits[d1 * K + k] = 0.2;
    state.traits[d2 * K + k] = 0.6;
    state.traits[d3 * K + k] = 0.8;
  }
  const params = buildParams(state);
  applySpillover(state, params);
  const rate = simConfig.constants.spilloverRate;
  for (let k = 0; k < K; k++) {
    const expected = 0.2 + rate * ((0.6 + 0.8) / 2 - 0.2);
    assert.ok(Math.abs(state.traits[d1 * K + k] - expected) < 1e-12, `trait ${TRAITS[k]}`);
  }
});

test('volatility 1.5 raises noise SD and shock frequency by 50%', () => {
  const measure = (volatility) => {
    const state = createInitialState(simConfig);
    const params = buildParams(state, { volatility });
    const base = new Float64Array(state.traits);
    const rng = mulberry32(2026);
    let sumSq = 0;
    let n = 0;
    for (let rep = 0; rep < 400; rep++) {
      state.traits.set(base);
      applyNoise(state, params, rng);
      for (let j = 0; j < base.length; j++) {
        const d = state.traits[j] - base[j];
        sumSq += d * d;
        n++;
      }
    }
    const shocks = [];
    const months = 20000;
    const shockRng = mulberry32(7);
    for (let m = 0; m < months; m++) applyShocks(state, 1, params, shockRng, shocks);
    return { sd: Math.sqrt(sumSq / n), shockRate: shocks.length / (months * params.districtIds.length) };
  };
  const calm = measure(1);
  const noisy = measure(1.5);
  const sdRatio = noisy.sd / calm.sd;
  const shockRatio = noisy.shockRate / calm.shockRate;
  assert.ok(Math.abs(sdRatio - 1.5) < 0.03, `noise SD ratio ${sdRatio}`);
  assert.ok(Math.abs(shockRatio - 1.5) < 0.08, `shock rate ratio ${shockRatio}`);
  assert.ok(Math.abs(calm.shockRate - simConfig.constants.shockChance) < 0.005, `base shock rate ${calm.shockRate}`);
});

test('every shock carries its district\'s named flavour for narration (no extra RNG draws)', () => {
  const { SHOCK_NAMES, runSingleSimulation: run } = require('../step');
  const { createInitialState: init } = require('../state');
  const config = require('../../../data/sim.json');
  assert.deepEqual(SHOCK_NAMES, { D1: 'Coastal Storm', D2: 'Cooling Grid Outage', D3: 'School Quarantine', D4: 'Warehouse Transformer Failure', D5: 'Unplugged Relay Cut' });
  const shocky = { ...config, constants: { ...config.constants, shockChance: 0.5 } };
  const r = run(init(shocky), {}, 12345); // realized run: shocks are tracked
  assert.ok(r.shocks.length > 5);
  for (const sh of r.shocks) assert.equal(sh.name, SHOCK_NAMES[sh.district]);
  // Names are labels only: the same seed gives the same trajectory with or without tracking.
  assert.deepEqual(Array.from(run(init(shocky), {}, 12345, true).gdw).length, r.gdw.length);
  assert.deepEqual(Array.from(run(init(shocky), {}, 12345).gdw), Array.from(r.gdw), 'deterministic');
});
