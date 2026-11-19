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

test('computeGDW clamps at 0 when W <= 0.275 and at 100 when W >= 0.775', () => {
  const gdwCfg = simConfig.gdw;
  assert.equal(computeGDW(0.275, gdwCfg), 0);
  assert.equal(computeGDW(0.05, gdwCfg), 0);
  assert.equal(computeGDW(-1, gdwCfg), 0);
  assert.equal(computeGDW(0.775, gdwCfg), 100);
  assert.equal(computeGDW(1.7, gdwCfg), 100);
  assert.equal(computeGDW(0.525, gdwCfg), 50);

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

test('trait names in server/sim match the data/crises.json effect schema', () => {
  const crises = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'crises.json'), 'utf8'));
  const simTraits = [...simConfig.traits].sort();
  assert.deepEqual(simTraits, ['autonomy', 'connection', 'fairness', 'health', 'purpose', 'trust']);
  assert.deepEqual(Object.keys(simConfig.weights).sort(), simTraits);
  for (const row of Object.values(simConfig.sensitivity)) assert.deepEqual(Object.keys(row).sort(), simTraits);
  for (const c of crises.crises) {
    for (const key of ['A', 'B']) {
      const o = c.options[key];
      const vectors = o.effectsByWorld ? Object.values(o.effectsByWorld) : o.effects ? [o.effects] : [];
      for (const e of vectors) assert.deepEqual(Object.keys(e).sort(), simTraits, `${c.id}.${key}`);
    }
  }
});

test('getCitizenMood reads the wellbeing and traits of the citizen\'s own (district, cohort)', () => {
  const simConfig = require('../../../data/sim.json');
  const citizens = require('../../../data/citizens.json');
  const { createInitialState, getCitizenMood, cohortWellbeingAt, cohortTraits } = require('../state');
  const state = createInitialState(simConfig);
  // Push one cohort (D4 elders, Ruth's) up so the lookup must find exactly it.
  const K = state.traitNames.length;
  const i = state.cohorts.findIndex((c) => c.key === 'D4:elders');
  for (let k = 0; k < K; k++) state.traits[i * K + k] = 0.9;
  for (const citizen of citizens) {
    const mood = getCitizenMood(state, citizen);
    const j = state.cohorts.findIndex((c) => c.district === citizen.district && c.cohort === citizen.cohort);
    assert.ok(mood, citizen.id);
    assert.equal(mood.key, `${citizen.district}:${citizen.cohort}`);
    assert.equal(mood.wellbeing, cohortWellbeingAt(state, j));
    assert.deepEqual(mood.traits, cohortTraits(state, j));
  }
  const ruth = getCitizenMood(state, citizens.find((c) => c.id === 'ruth'));
  const mara = getCitizenMood(state, citizens.find((c) => c.id === 'mara'));
  assert.ok(ruth.wellbeing > mara.wellbeing && ruth.gdw > mara.gdw);
  assert.equal(getCitizenMood(state, { district: 'D9', cohort: 'youth' }), null);
});
