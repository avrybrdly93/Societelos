'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pathGdw, fixedPath } = require('../calibrate');
const { simulate, createInitialState } = require('../index');
const simConfig = require('../../../data/sim.json');
const crises = require('../../../data/crises.json');

test('comfortable 1B -> 2B path (Gilded Cage) reaches ~51% GDW after Cycle 2', () => {
  const [start, afterC1, afterC2] = pathGdw(simConfig, crises, ['B', 'B']);
  assert.equal(start, 25);
  assert.ok(afterC1 > start, `1B raises GDW (${afterC1.toFixed(1)})`);
  assert.ok(afterC2 >= 46 && afterC2 <= 56, `BB after cycle 2: ${afterC2.toFixed(1)} (target ~51)`);
});

test('turbulent 1A -> 2A path (Commonwealth) drops toward ~13% without premature collapse', () => {
  const [start, afterC1, afterC2] = pathGdw(simConfig, crises, ['A', 'A']);
  assert.ok(afterC1 < start, `1A lowers GDW (${afterC1.toFixed(1)})`);
  assert.ok(afterC2 >= 9 && afterC2 <= 17, `AA after cycle 2: ${afterC2.toFixed(1)} (target ~13)`);
  // Collapse stays rare on this path: the 500-run forecast for 2A after 1A.
  const fixed = fixedPath(crises, 'A');
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
  // Every option of every cycle 1-2 crisis on the tree (2B after 1A and after 1B for the off-switch).
  const expected = crises.crises.filter((c) => c.world === 'fixed')
    .reduce((n, c) => n + ['A', 'B'].reduce((m, k) => m + (c.options[k].effectsByWorld ? Object.keys(c.options[k].effectsByWorld).length : 1), 0), 0);
  assert.equal(out.options.length, expected);
  assert.equal(new Set(out.options.map((o) => o.option)).size, expected, 'every row labelled uniquely');
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

test('every crisis (the whole tree and the Blitz extras) loads into calibrate.js with valid forecasts', () => {
  const { calibrateCrises } = require('../calibrate');
  const rows = calibrateCrises(simConfig, crises);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, crises.crises.length);
  // The tree: 3 opening crises + 4 cycle 2 crises (only fixed-2-offswitch is played), 4 worlds x 3 crises (cycles 3-4), 4 finales.
  const core = crises.crises.filter((c) => typeof c.path === 'string' || Object.values(crises.worlds).some((w) => w.finale === c.id));
  assert.equal(core.length, 23);
  for (const c of core) assert.ok(rows.filter((r) => r.id === c.id).length === 2, `${c.id}: both options forecast`);
  const bad = rows.filter((r) => !r.ok);
  assert.deepEqual(bad.map((r) => `${r.id} ${r.option}: ${r.problems.join('; ')}`), []);
  assert.ok(rows.every((r) => Number.isFinite(r.medianDelta) && r.spread >= 0));
});
