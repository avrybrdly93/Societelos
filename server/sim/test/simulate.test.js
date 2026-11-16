'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { simulate, createInitialState } = require('../index');
const simConfig = require('../../../data/sim.json');

const EFFECTS = { purpose: 0.3, connection: -0.2, health: 0.1, trust: -0.4, fairness: 0.5, autonomy: 0.2 };

test('500 forecast runs + 1 realized run execute in < 50 ms', () => {
  const state = createInitialState(simConfig);
  simulate(state, EFFECTS, { runs: 500, seed: 1 }); // warm up the JIT and topology cache
  // Best of 5, so a busy CI machine running tests in parallel does not flake.
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    simulate(state, EFFECTS, { runs: 500, seed: 100 + i });
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(best < 50, `best of 5: ${best.toFixed(1)} ms`);
});

test('forecast percentiles are ordered p5 <= median <= p95 for every month 1-12', () => {
  const state = createInitialState(simConfig);
  for (const [effects, volatility] of [[EFFECTS, 1], [{ purpose: -0.9, connection: -0.9, health: -0.9, trust: -0.9, fairness: -0.9, autonomy: -0.9 }, 1.5]]) {
    const { forecast } = simulate(state, effects, { runs: 500, seed: 7, volatility });
    assert.equal(forecast.median.length, 13);
    for (let t = 1; t <= 12; t++) {
      assert.ok(forecast.p5[t] <= forecast.median[t] && forecast.median[t] <= forecast.p95[t], `month ${t}: ${forecast.p5[t]} / ${forecast.median[t]} / ${forecast.p95[t]}`);
    }
  }
});
