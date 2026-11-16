'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mulberry32 } = require('../prng');

test('mulberry32 produces identical sequences for identical seeds', () => {
  const a = mulberry32(20261119);
  const b = mulberry32(20261119);
  const seqA = Array.from({ length: 1000 }, () => a());
  const seqB = Array.from({ length: 1000 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('mulberry32 sequences differ for different seeds and stay in [0, 1)', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 100 }, () => a());
  const seqB = Array.from({ length: 100 }, () => b());
  assert.notDeepEqual(seqA, seqB);
  for (const v of [...seqA, ...seqB]) assert.ok(v >= 0 && v < 1);
});
