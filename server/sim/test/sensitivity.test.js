'use strict';

// Design checks on the sensitivity table S in data/sim.json: who feels what.

const test = require('node:test');
const assert = require('node:assert/strict');

const { sensitivity: S } = require('../../../data/sim.json');

/** Mean sensitivity to `trait` across all 20 cohorts. */
const mean = (trait) => Object.values(S).reduce((a, row) => a + row[trait], 0) / Object.keys(S).length;

test('D1 elite has negative fairness sensitivity (loses out under redistribution)', () => {
  assert.ok(S['D1:elite'].fairness < 0, `D1:elite fairness ${S['D1:elite'].fairness}`);
});
