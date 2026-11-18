'use strict';

// Offline Demo Mandate (TASK-742 / TASK-743): with a GEMINI_API_KEY set but
// no internet (classroom router, Wi-Fi dropped), every Loom call must fall
// back cleanly and the game must run Lobby -> END on authored content.

const test = require('node:test');
const assert = require('node:assert/strict');

const loom = require('../loom');
const { playGame } = require('./playGame');

/** Replace global fetch for one test; returns a call counter. */
function stubFetch(t, impl) {
  const real = globalThis.fetch;
  const calls = { n: 0 };
  globalThis.fetch = (...args) => { calls.n++; return impl(...args); };
  t.after(() => { globalThis.fetch = real; if (loom.resetCircuit) loom.resetCircuit(); });
  if (loom.resetCircuit) loom.resetCircuit();
  return calls;
}

const quietErrors = (t) => {
  const err = console.error;
  console.error = () => {};
  t.after(() => { console.error = err; });
};

// TASK-742: every narrate / moderate path has a catch that falls back, so a
// dead network never stalls a phase, leaks an error or loses a cycle.
test('a full 5-cycle game completes with a key set and the network down (fetch rejects)', async (t) => {
  quietErrors(t);
  const calls = stubFetch(t, () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })));
  const out = await playGame({ gameId: 'offline-mandate-1', world: 'BA', apiKey: 'test-key-no-network' });
  assert.equal(out.end.phase, 'END');
  assert.ok(out.gameEnd, 'End Screen data compiled');
  assert.equal(out.resolutions.length, 5, 'all 5 cycles resolved');
  assert.equal(out.gameEnd.cyclesPlayed, 5);
  out.resolutions.forEach((r, i) => {
    assert.ok(r.loomLine && r.loomLine.length <= 200, `cycle ${i + 1} has an offline Loom line`);
    assert.ok(Array.isArray(r.messages) && r.messages.length > 0, `cycle ${i + 1} has citizen messages`);
    assert.doesNotMatch(r.loomLine, /fetch failed|ENOTFOUND|Error/, 'no raw error text reaches the projector');
  });
  assert.ok(calls.n >= 1, 'the Loom did try the network');
  // Cycle 5 still produced a policy package (write-ins moderated offline or the A/B fallback).
  assert.ok(['writein', 'fallback'].includes(out.gameEnd.finaleMode), `finaleMode ${out.gameEnd.finaleMode}`);
});
