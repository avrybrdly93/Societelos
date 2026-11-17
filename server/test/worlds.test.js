'use strict';

// World balance guard (TASK-534): the Gilded Cage (BB) opens with the easiest
// cycles 1-2 (1B -> 2B, the highest GDW), so its late crises must punish
// complacency hardest. Chains each world's own cycle 1-2 path into every
// cycle 3-4 A/B combination with the real simulation (500 forecast runs).

const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate, createInitialState, computeGDW } = require('../sim');
const simConfig = require('../../data/sim.json');
const crises = require('../../data/crises.json');

const RUNS = 500;
const SEED = 20261119;
const last = (a) => a[a.length - 1];
const fixed = crises.crises.filter((c) => c.world === 'fixed').sort((a, b) => a.cycle - b.cycle);

/** Simulated state at the end of cycle 2 along `world`'s path, and its volatility. */
function cycle2State(world) {
  const [v1, v2] = world.split('');
  let state = createInitialState(simConfig);
  let volatility = 1;
  [v1, v2].forEach((v, i) => {
    const o = fixed[i].options[v];
    const effects = o.effectsByWorld ? o.effectsByWorld[v1] : o.effects;
    state = simulate(state, effects, { runs: RUNS, seed: SEED + i, volatility }).finalState;
    if (typeof o.volatility === 'number') volatility = o.volatility;
  });
  return { state, volatility };
}
const worldCrises = (world) => crises.crises.filter((c) => c.world === world && (c.cycle === 3 || c.cycle === 4)).sort((a, b) => a.cycle - b.cycle);
const medianDelta = (start, effects, volatility) => last(simulate(start, effects, { runs: RUNS, seed: SEED + 2, volatility }).forecast.median) - computeGDW(start);

/** { afterCycle2, ends: { AA: gdw, AB, BA, BB } } for cycles 3-4 choices. */
function worldPaths(world) {
  const [v1, v2] = world.split('');
  let state = createInitialState(simConfig);
  let volatility = 1;
  [v1, v2].forEach((v, i) => {
    const o = fixed[i].options[v];
    const effects = o.effectsByWorld ? o.effectsByWorld[v1] : o.effects;
    state = simulate(state, effects, { runs: RUNS, seed: SEED + i, volatility }).finalState;
    if (typeof o.volatility === 'number') volatility = o.volatility;
  });
  const c3 = crises.crises.find((c) => c.world === world && c.cycle === 3);
  const c4 = crises.crises.find((c) => c.world === world && c.cycle === 4);
  const ends = {};
  for (const a of ['A', 'B']) {
    const r3 = simulate(state, c3.options[a].effects, { runs: RUNS, seed: SEED + 2, volatility });
    for (const b of ['A', 'B']) {
      const r4 = simulate(r3.finalState, c4.options[b].effects, { runs: RUNS, seed: SEED + 3, volatility });
      ends[a + b] = last(r4.forecast.median);
    }
  }
  return { afterCycle2: computeGDW(state), ends };
}

test('World BB: the comfortable 1B -> 2B opening is punished hardest in cycles 3-4', () => {
  const worlds = Object.fromEntries(['AA', 'AB', 'BA', 'BB'].map((w) => [w, worldPaths(w)]));
  const worstDrop = (w) => Math.min(...Object.values(worlds[w].ends)) - worlds[w].afterCycle2;
  // BB starts cycle 3 highest...
  for (const w of ['AA', 'AB', 'BA']) assert.ok(worlds.BB.afterCycle2 > worlds[w].afterCycle2, `BB opens above ${w}`);
  // ...and its worst cycles 3-4 path falls further than any other world's.
  for (const w of ['AA', 'AB', 'BA']) assert.ok(worstDrop('BB') < worstDrop(w) - 5, `BB worst drop ${worstDrop('BB').toFixed(1)} vs ${w} ${worstDrop(w).toFixed(1)}`);
  // The comfort options (lotus/assimilator: the stipend, then the sweep) are that worst path: a drop of 10+.
  const bb = crises.crises.filter((c) => c.world === 'BB' && (c.cycle === 3 || c.cycle === 4)).sort((a, b) => a.cycle - b.cycle);
  const comfort = bb.map((c) => ['A', 'B'].find((k) => (c.options[k].roles || []).includes('lotus'))).join('');
  assert.ok(worlds.BB.ends[comfort] - worlds.BB.afterCycle2 <= -10, `BB comfort path ${comfort} drops ${(worlds.BB.ends[comfort] - worlds.BB.afterCycle2).toFixed(1)}`);
});

test('World AA: cycle 3-4 crises hinge on purpose and autonomy, with real GDW tension', () => {
  const { state, volatility } = cycle2State('AA');
  for (const c of worldCrises('AA')) {
    const { A, B } = c.options;
    for (const o of [A, B]) {
      assert.ok(Math.abs(o.effects.purpose) >= 0.4, `${c.id} ${o.name}: purpose moves`);
      assert.ok(Math.abs(o.effects.autonomy) >= 0.4, `${c.id} ${o.name}: autonomy moves`);
    }
    assert.ok(Math.sign(A.effects.autonomy) !== Math.sign(B.effects.autonomy), `${c.id}: the options pull autonomy opposite ways`);
    const gap = Math.abs(medianDelta(state, A.effects, volatility) - medianDelta(state, B.effects, volatility));
    assert.ok(gap >= 4, `${c.id}: options ${gap.toFixed(1)} GDW apart`);
  }
});
