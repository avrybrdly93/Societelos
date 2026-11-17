'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pathGdw } = require('../calibrate');
const { simulate, createInitialState } = require('../index');
const simConfig = require('../../../data/sim.json');
const crises = require('../../../data/crises.json');

test('comfortable 1B -> 2B path (Gilded Cage) reaches ~40% GDW after Cycle 2', () => {
  const [start, afterC1, afterC2] = pathGdw(simConfig, crises, ['B', 'B']);
  assert.equal(start, 25);
  assert.ok(afterC1 > start, `1B raises GDW (${afterC1.toFixed(1)})`);
  assert.ok(afterC2 >= 36 && afterC2 <= 44, `BB after cycle 2: ${afterC2.toFixed(1)} (target ~40)`);
});

test('turbulent 1A -> 2A path (Commonwealth) drops toward ~15% without premature collapse', () => {
  const [start, afterC1, afterC2] = pathGdw(simConfig, crises, ['A', 'A']);
  assert.ok(afterC1 < start, `1A lowers GDW (${afterC1.toFixed(1)})`);
  assert.ok(afterC2 >= 12 && afterC2 <= 19, `AA after cycle 2: ${afterC2.toFixed(1)} (target ~15)`);
  // Collapse stays rare on this path: the 500-run forecast for 2A after 1A.
  const fixed = crises.crises.filter((c) => c.world === 'fixed').sort((a, b) => a.cycle - b.cycle);
  const c1 = simulate(createInitialState(simConfig), fixed[0].options.A.effects, { runs: 500, seed: 1 });
  const c2 = simulate(c1.finalState, fixed[1].options.A.effects, { runs: 500, seed: 2 });
  assert.ok(c2.forecast.pCollapse < 0.02, `P(collapse) ${c2.forecast.pCollapse}`);
  assert.ok(c2.realized.finalGdw > 0, 'realized run does not collapse');
});

test('server/sim/calibrate.js runs standalone without starting Express', () => {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const script = path.join(__dirname, '..', 'calibrate.js');
  // Preload a hook that fails if express or the server is ever required.
  const guard = "const M=require('module');const o=M._load;M._load=function(r,...a){if(/^express$|server\\.js$|socket\\.io$/.test(r))throw new Error('loaded '+r);return o.call(this,r,...a)};";
  const r = spawnSync(process.execPath, ['-e', `${guard}process.argv.push('--json');require(${JSON.stringify(script)}).main()`], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.runs, 500);
  assert.equal(out.options.length, 5, '1A, 1B, 2A, 2B after 1A, 2B after 1B');
  assert.deepEqual(out.paths.map((p) => p.path), ['AA', 'AB', 'BA', 'BB']);
});

test('trajectory sweep: deterministic, every game lands in exactly one final-GDW band', () => {
  const { sweepGames, SWEEP_BANDS } = require('../calibrate');
  const simConfig = require('../../../data/sim.json');
  const crisesData = require('../../../data/crises.json');
  const a = sweepGames(simConfig, crisesData, { games: 60 });
  const b = sweepGames(simConfig, crisesData, { games: 60 });
  assert.deepEqual(a.counts, b.counts, 'same seed, same result');
  assert.equal(Object.values(a.counts).reduce((x, y) => x + y, 0), 60);
  assert.deepEqual(Object.keys(a.counts), SWEEP_BANDS.map((x) => x.key));
  assert.ok(a.finals.every((g) => g >= 0 && g <= 100));
});

test('every crisis (2 fixed, every world set cycles 3-4, and the finales) loads into calibrate.js with valid forecasts', () => {
  const { calibrateCrises } = require('../calibrate');
  const rows = calibrateCrises(simConfig, crises);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, crises.crises.length);
  const core = crises.crises.filter((c) => c.world === 'fixed' || (c.mode === 'binary' && c.cycle <= 4) || Object.values(crises.worlds).some((w) => w.finale === c.id));
  assert.equal(core.length, 22);
  for (const c of core) assert.ok(rows.filter((r) => r.id === c.id).length === 2, `${c.id}: both options forecast`);
  const bad = rows.filter((r) => !r.ok);
  assert.deepEqual(bad.map((r) => `${r.id} ${r.option}: ${r.problems.join('; ')}`), []);
  assert.ok(rows.every((r) => Number.isFinite(r.medianDelta) && r.spread >= 0));
});
