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
