'use strict';

// Benchmark: node server/sim/test/bench.js  (npm run bench:sim)
// Target: a single 12-month run under 0.2 ms; a full 500-run cycle under 50 ms.

const path = require('path');
const fs = require('fs');
const { createInitialState } = require('../state');
const { runSingleSimulation } = require('../step');
const { simulate } = require('..');

const simConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'sim.json'), 'utf8'));
const state = createInitialState(simConfig);
const effects = { purpose: 0.3, connection: -0.2, health: 0.4, trust: 0.1, fairness: -0.3, autonomy: 0.2 };

function timeIt(label, n, fn) {
  for (let i = 0; i < Math.min(200, n); i++) fn(i); // warm-up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  console.log(`${label.padEnd(28)} ${ms.toFixed(3)} ms`);
  return ms;
}

const realized = timeIt('single realized run', 5000, (i) => runSingleSimulation(state, effects, i, false));
const forecast = timeIt('single forecast run', 5000, (i) => runSingleSimulation(state, effects, i, true));
const cycle = timeIt('simulate (500 + 1 runs)', 20, (i) => simulate(state, effects, { seed: i }));

const ok = realized < 0.2 && forecast < 0.2 && cycle < 50;
console.log(ok ? 'PASS' : 'FAIL', '(targets: run < 0.2 ms, cycle < 50 ms)');
process.exit(ok ? 0 : 1);
