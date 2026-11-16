#!/usr/bin/env node
'use strict';

// Calibration runner: 500 forecasts for each fixed-crisis option from the
// starting state, printing median GDW change against the design targets
// (targetGdwDelta in data/crises.json). Standalone: no server, no network.
//   node server/sim/calibrate.js          (npm run calibrate)
//   node server/sim/calibrate.js --json   machine-readable output
//
// The data files are loaded with require() (no fs), so server/sim keeps its
// no-I/O rule (npm run check:sim) and the simulation stays pure.

const { simulate, createInitialState, computeGDW } = require('./index');

const readJson = (name) => require(`../../data/${name}`);

const RUNS = 500;
const SEED = 20261119;

/** Median end-of-cycle GDW change for `effects` from `state`. */
function medianDelta(state, effects, { seed = SEED, volatility = 1 } = {}) {
  const r = simulate(state, effects, { runs: RUNS, seed, volatility });
  const start = computeGDW(state);
  return { median: r.forecast.median[r.forecast.median.length - 1] - start, realized: r.realized.finalGdw - start, result: r };
}

/** One row per fixed option (2B once per Cycle 1 world). */
function calibrateFixed(simConfig, crises) {
  const start = createInitialState(simConfig);
  const fixed = crises.crises.filter((c) => c.world === 'fixed').sort((a, b) => a.cycle - b.cycle);
  const rows = [];
  for (const crisis of fixed) {
    for (const key of ['A', 'B']) {
      const o = crisis.options[key];
      const variants = o.effectsByWorld ? Object.entries(o.effectsByWorld).map(([w, e]) => [`${crisis.cycle}${key} (after 1${w})`, e]) : [[`${crisis.cycle}${key}`, o.effects]];
      for (const [label, effects] of variants) {
        const { median, realized } = medianDelta(start, effects);
        rows.push({ option: label, name: o.name, target: typeof o.targetGdwDelta === 'number' ? o.targetGdwDelta : null, median, realized });
      }
    }
  }
  return rows;
}

/** GDW after two cycles along a path, e.g. ['A', 'A'] (1A then 2A). */
function pathGdw(simConfig, crises, votes, seed = SEED) {
  let state = createInitialState(simConfig);
  let volatility = 1;
  const fixed = crises.crises.filter((c) => c.world === 'fixed').sort((a, b) => a.cycle - b.cycle);
  const trace = [computeGDW(state)];
  votes.forEach((vote, i) => {
    const o = fixed[i].options[vote];
    const effects = o.effectsByWorld ? o.effectsByWorld[votes[0]] : o.effects;
    const r = simulate(state, effects, { runs: RUNS, seed: seed + i, volatility });
    trace.push(r.forecast.median[r.forecast.median.length - 1]);
    state = r.finalState;
    if (typeof o.volatility === 'number') volatility = o.volatility;
  });
  return trace;
}

function main() {
  const simConfig = readJson('sim.json');
  const crises = readJson('crises.json');
  const rows = calibrateFixed(simConfig, crises);
  const paths = ['AA', 'AB', 'BA', 'BB'].map((p) => ({ path: p, gdw: pathGdw(simConfig, crises, p.split('')) }));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ runs: RUNS, seed: SEED, options: rows, paths }, null, 2));
    return;
  }
  const f = (v) => (v === null ? '  n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`.padStart(6));
  console.log(`Calibration: ${RUNS} forecast runs per option, seed ${SEED}, start GDW ${computeGDW(createInitialState(simConfig)).toFixed(1)}`);
  console.log('option            target  median  realized  name');
  for (const r of rows) console.log(`${r.option.padEnd(16)}  ${f(r.target)}  ${f(r.median)}  ${f(r.realized)}    ${r.name}`);
  console.log('\nTwo-cycle paths (median GDW: start -> after cycle 1 -> after cycle 2):');
  for (const p of paths) console.log(`  ${p.path}: ${p.gdw.map((v) => v.toFixed(1)).join(' -> ')}`);
}

if (require.main === module) main();

module.exports = { medianDelta, calibrateFixed, pathGdw, RUNS, SEED };
