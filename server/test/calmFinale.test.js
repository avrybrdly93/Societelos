'use strict';
// A satisfied city must not riot: a crisis with a `calm` variant swaps its story
// text once satisfaction (GDW) reaches the threshold; options stay identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const crises = require('../../data/crises.json');
const { selectCrisis, applyCalmVariant } = require('../gameEngine');

const march = () => selectCrisis(crises, 5, 'BB', [], true);

test('March on the Datacenter keeps the siege when satisfaction is low', () => {
  const c = applyCalmVariant(march(), 40);
  assert.match(c.incident, /surround/);
  assert.equal(c.calm, undefined);
});

test('March on the Datacenter becomes a quiet petition when satisfaction is high', () => {
  const c = applyCalmVariant(march(), 70);
  assert.doesNotMatch(c.incident, /surround|demanding/);
  assert.match(c.incident, /petition/);
  assert.equal(c.calm, undefined);
  assert.deepEqual(c.options, march().options);
});

test('the threshold itself counts as calm', () => {
  assert.match(applyCalmVariant(march(), 60).incident, /petition/);
  assert.match(applyCalmVariant(march(), 59.9).incident, /surround/);
});
