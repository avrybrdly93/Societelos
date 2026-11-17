#!/usr/bin/env node
'use strict';

// Calibration runner: 500 forecasts for each fixed-crisis option from the
// starting state, printing median GDW change against the design targets
// (targetGdwDelta in data/crises.json). Standalone: no server, no network.
//   node server/sim/calibrate.js          (npm run calibrate)
//   node server/sim/calibrate.js --json   machine-readable output
//   node server/sim/calibrate.js --sweep  1,000 random games: final-GDW bands
//
// The data files are loaded with require() (no fs), so server/sim keeps its
// no-I/O rule (npm run check:sim) and the simulation stays pure.

const { simulate, createInitialState, computeGDW } = require('./index');
const { runSingleSimulation } = require('./step');
const { mulberry32, hashSeed } = require('./prng');

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

// Final-GDW bands for a whole game (TASK-561 targets for random play).
const SWEEP_BANDS = [
  { key: 'collapse', label: 'Collapse (0)', test: (g) => g <= 0, target: [15, 25] },
  { key: 'fragile', label: 'Fragile (1-34)', test: (g) => g > 0 && g < 35, target: [20, 30] },
  { key: 'stable', label: 'Stable (35-59)', test: (g) => g >= 35 && g < 60, target: [35, 45] },
  { key: 'thriving', label: 'Thriving (60+)', test: (g) => g >= 60, target: [15, 25] }
];

/**
 * Monte Carlo trajectory sweep: `games` whole games (cycles 1-5) with every
 * A/B choice drawn at random, each cycle one realized run chained from the
 * last (volatility carried from 2A; cycle 5 plays the world finale's
 * authored A/B, as when Gemini is unavailable). A game ends early at GDW 0.
 * Deterministic for a given seed. Returns { games, counts, shares, finals }.
 */
function sweepGames(simConfig, crises, { games = 1000, seed = SEED } = {}) {
  const pick = mulberry32(hashSeed(`sweep:${seed}`));
  const fixed = crises.crises.filter((c) => c.world === 'fixed').sort((a, b) => a.cycle - b.cycle);
  const start = createInitialState(simConfig);
  const counts = Object.fromEntries(SWEEP_BANDS.map((b) => [b.key, 0]));
  const finals = [];
  for (let g = 0; g < games; g++) {
    let state = start;
    let volatility = 1;
    let gdw = computeGDW(state);
    const votes = [];
    const play = (option, effects, cycle) => {
      const run = runSingleSimulation(state, effects, hashSeed(`${seed}:${g}:${cycle}`), false, { volatility });
      state = run.finalState;
      gdw = run.gdw[run.gdw.length - 1];
      if (typeof option.volatility === 'number') volatility = option.volatility;
    };
    for (let i = 0; i < fixed.length && gdw > 0; i++) {
      const vote = pick() < 0.5 ? 'A' : 'B';
      votes.push(vote);
      const o = fixed[i].options[vote];
      play(o, o.effectsByWorld ? o.effectsByWorld[votes[0]] : o.effects, i + 1);
    }
    const world = votes.join('');
    const worldInfo = crises.worlds && crises.worlds[world];
    const later = [3, 4].map((cy) => crises.crises.find((c) => c.world === world && c.cycle === cy));
    if (worldInfo) later.push(crises.crises.find((c) => c.id === worldInfo.finale));
    later.forEach((crisis, i) => {
      if (!crisis || gdw <= 0) return;
      const o = crisis.options[pick() < 0.5 ? 'A' : 'B'];
      play(o, o.effects, i + 3);
    });
    const final = Math.max(0, gdw);
    finals.push(final);
    const band = SWEEP_BANDS.find((b) => b.test(final));
    counts[band.key]++;
  }
  const shares = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / games]));
  return { games, counts, shares, finals };
}

function main() {
  if (process.argv.includes('--sweep')) {
    const n = Number((process.argv.find((a) => /^--games=\d+$/.test(a)) || '').split('=')[1]) || 1000;
    const r = sweepGames(readJson('sim.json'), readJson('crises.json'), { games: n });
    if (process.argv.includes('--json')) { console.log(JSON.stringify({ games: r.games, counts: r.counts, shares: r.shares })); return; }
    const sorted = r.finals.slice().sort((a, b) => a - b);
    console.log(`Trajectory sweep: ${r.games} games, random A/B every cycle (finale: authored A/B), seed ${SEED}`);
    for (const b of SWEEP_BANDS) {
      const pct = r.shares[b.key] * 100;
      const ok = pct >= b.target[0] && pct <= b.target[1];
      console.log(`  ${b.label.padEnd(16)} ${String(r.counts[b.key]).padStart(5)}  ${pct.toFixed(1).padStart(5)}%   target ${b.target[0]}-${b.target[1]}%  ${ok ? 'ok' : 'OFF'}`);
    }
    console.log(`  final GDW: median ${sorted[sorted.length >> 1].toFixed(1)}, p10 ${sorted[Math.floor(sorted.length * 0.1)].toFixed(1)}, p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(1)}`);
    return;
  }
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

module.exports = { main, medianDelta, calibrateFixed, pathGdw, sweepGames, SWEEP_BANDS, RUNS, SEED };
