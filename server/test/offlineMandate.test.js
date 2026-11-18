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

// TASK-743: once the network is known to be dead, Loom calls fall back in
// well under 100 ms instead of each waiting out the 8 s timeout.
const cfg = (timeoutMs = 8000) => ({ apiKey: 'k', enabled: true, model: 'gemini-test', timeoutMs });
const quietLog = { logger: () => {} };
const hang = (url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

test('after one hung request times out, the next Loom calls fall back in < 100 ms without touching the network', async () => {
  const circuit = loom.createCircuit();
  let calls = 0;
  const fetchImpl = (...a) => { calls++; return hang(...a); };
  const t0 = Date.now();
  await assert.rejects(loom.callGemini('x', { ...quietLog, config: cfg(60), fetchImpl, circuit }), { name: 'AbortError' });
  assert.ok(Date.now() - t0 >= 50, 'the first call waited for its timeout');
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    await assert.rejects(loom.callGemini('x', { ...quietLog, config: cfg(60), fetchImpl, circuit }), { code: 'LOOM_CIRCUIT_OPEN' });
    assert.ok(Date.now() - t < 100, `call ${i + 2} took ${Date.now() - t} ms`);
  }
  assert.equal(calls, 1, 'only the first call reached the network');
  assert.equal(circuit.trips, 1);
});

test('narrate and moderate return their fallbacks in < 100 ms while the breaker is open', async () => {
  const circuit = loom.createCircuit();
  circuit.openUntil = Date.now() + 60000;
  const fetchImpl = () => { throw new Error('must not be called'); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    let t = Date.now();
    const n = await loom.narrate({ crisis: { title: 'T' }, winningOption: { name: 'A', loomLines: { good: 'g', mixed: 'm', bad: 'b' } }, summary: { realizedDelta: 4 } }, { ...quietLog, config: cfg(), fetchImpl, circuit });
    assert.ok(Date.now() - t < 100);
    assert.ok(n.loomLine && n.fallback, 'offline narration');
    t = Date.now();
    const m = await loom.moderate([{ node: 'NODE-01', text: 'Every district gets a repair guild.' }], { title: 'T' }, { ...quietLog, config: cfg(), fetchImpl, circuit });
    assert.ok(Date.now() - t < 100);
    assert.equal(m.length, 1);
    assert.ok(['ok', 'revise', 'reject'].includes(m[0].status));
  } finally {
    console.warn = warn;
  }
});

test('an HTTP error (Gemini reachable) does not open the breaker; a refused connection does', async () => {
  const circuit = loom.createCircuit();
  const http500 = async () => ({ ok: false, status: 500, headers: { get: () => null } });
  await assert.rejects(loom.callGemini('x', { ...quietLog, config: cfg(), fetchImpl: http500, circuit }), /HTTP 500/);
  assert.equal(circuit.openUntil, 0);
  const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  await assert.rejects(loom.callGemini('x', { ...quietLog, config: cfg(), fetchImpl: refused, circuit }));
  assert.ok(circuit.openUntil > Date.now());
});

test('the breaker probes again after the cooldown, and a success closes it', async () => {
  const circuit = loom.createCircuit();
  const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(loom.callGemini('x', { ...quietLog, config: cfg(), fetchImpl: refused, circuit, offlineCooldownMs: 30 }));
  await new Promise((r) => setTimeout(r, 40));
  const ok = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"loomLine":"Back online."}' }] } }] }) });
  const r = await loom.callGemini('x', { ...quietLog, config: cfg(), fetchImpl: ok, circuit });
  assert.equal(r.loomLine, 'Back online.');
  assert.equal(circuit.openUntil, 0);
});

test('a full game with the network down hits it once, then plays on instant fallbacks', async (t) => {
  quietErrors(t);
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = warn; });
  const calls = stubFetch(t, () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } })));
  const out = await playGame({ gameId: 'offline-mandate-2', world: 'AB', apiKey: 'test-key-no-network' });
  assert.equal(out.end.phase, 'END');
  assert.equal(calls.n, 1, `the dead network was tried ${calls.n} times`);
});
