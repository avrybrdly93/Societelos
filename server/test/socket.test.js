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
