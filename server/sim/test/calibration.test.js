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
