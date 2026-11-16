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

test('D4 workers and elders are highly sensitive to autonomy and fairness', () => {
  for (const key of ['D4:workers', 'D4:elders']) {
    for (const trait of ['autonomy', 'fairness']) {
      assert.ok(S[key][trait] >= 1.2, `${key} ${trait} ${S[key][trait]}`);
      assert.ok(S[key][trait] > mean(trait), `${key} ${trait} above the regional mean ${mean(trait).toFixed(2)}`);
    }
  }
});

test('D2 youth are highly sensitive to connection and trust', () => {
  for (const trait of ['connection', 'trust']) {
    assert.ok(S['D2:youth'][trait] >= 1.3, `D2:youth ${trait} ${S['D2:youth'][trait]}`);
    assert.ok(S['D2:youth'][trait] > mean(trait), `above the regional mean ${mean(trait).toFixed(2)}`);
  }
});

test('every D5 cohort has heightened autonomy sensitivity (sympathetic to the Unplugged)', () => {
  for (const cohort of ['youth', 'workers', 'elders', 'elite']) {
    const v = S[`D5:${cohort}`].autonomy;
    assert.ok(v >= 1.2 && v > mean('autonomy'), `D5:${cohort} autonomy ${v} (mean ${mean('autonomy').toFixed(2)})`);
  }
});
