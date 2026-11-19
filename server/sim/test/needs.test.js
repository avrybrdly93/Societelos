'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sim = require('../index');
const { createInitialState: createSimState } = require('../state');
const data = require('../../../data/sim.json');

test('currentNeeds returns 0-100 means for all six traits', () => {
  const needs = sim.currentNeeds(createSimState(data));
  for (const t of ['purpose', 'connection', 'health', 'trust', 'fairness', 'autonomy']) {
    assert.ok(needs[t] >= 0 && needs[t] <= 100, t);
  }
});

test('realized run carries a needs snapshot per month', () => {
  const state = createSimState(data);
  const r = sim.simulate({ gdw: 25, simState: state }, {}, { runs: 5, seed: 7 });
  assert.strictEqual(r.realized.needs.length, r.realized.gdw.length);
  assert.ok(typeof r.realized.needs[12].health === 'number');
});
