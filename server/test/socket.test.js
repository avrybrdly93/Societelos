'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { allowEvent, RATE_BURST, RATE_PER_SECOND } = require('../socket');

test('per-client rate limit allows a burst, then refills over time', () => {
  const socket = { data: {} };
  const t0 = 1000000;
  for (let i = 0; i < RATE_BURST; i++) assert.equal(allowEvent(socket, t0), true);
  assert.equal(allowEvent(socket, t0), false, 'button-mashing beyond the burst is dropped');
  assert.equal(allowEvent(socket, t0 + 1000 / RATE_PER_SECOND), true, 'one token back after 1/rate s');
  assert.equal(allowEvent(socket, t0 + 1000 / RATE_PER_SECOND), false);
});

test('finale:* payloads are bounded and malformed packets are refused', () => {
  const { isValidPayload, FINALE_SCHEMAS } = require('../socket');
  assert.equal(isValidPayload({ text: 'Fund one workshop per street.' }, FINALE_SCHEMAS.submit), true);
  assert.equal(isValidPayload({ text: 'x'.repeat(1001) }, FINALE_SCHEMAS.submit), false);
  assert.equal(isValidPayload({ text: 42 }, FINALE_SCHEMAS.submit), false);
  assert.equal(isValidPayload({}, FINALE_SCHEMAS.submit), false);
  assert.equal(isValidPayload(['text'], FINALE_SCHEMAS.submit), false);
  assert.equal(isValidPayload({ order: ['POLICY-1', 'POLICY-2', 'POLICY-3', 'POLICY-4'] }, FINALE_SCHEMAS.rank), true);
  assert.equal(isValidPayload({ order: 'POLICY-1' }, FINALE_SCHEMAS.rank), false);
  assert.equal(isValidPayload({ order: [1, 2, 3, 4] }, FINALE_SCHEMAS.rank), false);
  assert.equal(isValidPayload({ order: new Array(11).fill('POLICY-1') }, FINALE_SCHEMAS.rank), false);
  assert.equal(isValidPayload({ order: ['x'.repeat(33)] }, FINALE_SCHEMAS.rank), false);
});
