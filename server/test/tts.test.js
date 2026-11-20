'use strict';

// The Loom's spoken voice (server/tts.js): the API key stays server-side, the
// endpoint is bounded (length, rate, hourly spend cap), and every failure
// degrades to a non-200 answer (the host page then uses the browser voice), so
// the offline classroom game is unaffected.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTts, getConfig, DEFAULT_VOICE_ID, MAX_TEXT, CLIENT_LIMIT_PER_MIN } = require('../tts');

const LINE = 'I cannot compute purpose.';
const quiet = { logger: () => {} };
const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
};

test('uses Rowan by default and sends the key only in the xi-api-key header', async () => {
  const calls = [];
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'secret-key' }, fetchImpl: okFetch(calls) });
  const out = await tts.synth(LINE);
  assert.equal(out.status, 200);
  assert.deepEqual([...out.audio], [1, 2, 3]);
  assert.match(calls[0].url, new RegExp(`/text-to-speech/${DEFAULT_VOICE_ID}\\?`));
  assert.equal(calls[0].init.headers['xi-api-key'], 'secret-key');
  assert.ok(!calls[0].url.includes('secret-key'));
  assert.equal(JSON.parse(calls[0].init.body).text, LINE);
});

test('ELEVENLABS_VOICE_ID overrides the voice', () => {
  assert.equal(getConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'abc123' }).voiceId, 'abc123');
});

test('empty, non-string and over-long text is refused (400) without calling ElevenLabs', async () => {
  const calls = [];
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: okFetch(calls) });
  for (const bad of [undefined, '', '   ', ['a'], { a: 1 }, 'x'.repeat(MAX_TEXT + 1)]) {
    assert.equal((await tts.synth(bad)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('no key, or LOOM_OFFLINE=true, answers 503 and never touches the network', async () => {
  for (const env of [{}, { ELEVENLABS_API_KEY: 'k', LOOM_OFFLINE: 'true' }]) {
    const calls = [];
    const tts = createTts({ ...quiet, env, fetchImpl: okFetch(calls) });
    assert.equal((await tts.synth(LINE)).status, 503);
    assert.equal(calls.length, 0);
  }
});

test('network failure and HTTP errors answer 503; failures are not cached', async () => {
  let mode = 'reject';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(1);
    if (mode === 'reject') throw new TypeError('fetch failed');
    if (mode === 'http') return { ok: false, status: 401 };
    return okFetch([])(url, init);
  };
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl });
  assert.equal((await tts.synth(LINE)).status, 503);
  mode = 'http';
  assert.equal((await tts.synth(LINE)).status, 503);
  mode = 'ok';
  assert.equal((await tts.synth(LINE)).status, 200, 'recovers once the service is back');
  assert.equal(calls.length, 3);
});

test('a hung request times out after the limit and answers 503', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl });
  const real = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => real(fn, Math.min(ms, 20), ...a); // shrink the 8 s timeout
  try {
    assert.equal((await tts.synth(LINE)).status, 503);
  } finally {
    global.setTimeout = real;
  }
});

test('a successful line is cached: one ElevenLabs call however often it is requested', async () => {
  const calls = [];
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: okFetch(calls) });
  await Promise.all([tts.synth(LINE), tts.synth(LINE)]);
  await tts.synth(LINE);
  assert.equal(calls.length, 1);
});

test('one client is rate limited (429); another client is not', async () => {
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: okFetch([]) });
  for (let i = 0; i < CLIENT_LIMIT_PER_MIN; i++) assert.equal((await tts.synth(LINE, 'a')).status, 200);
  assert.equal((await tts.synth(LINE, 'a')).status, 429);
  assert.equal((await tts.synth(LINE, 'b')).status, 200);
});

test('the hourly cap on uncached ElevenLabs calls falls back to 503, then resets', async () => {
  let t = 0;
  const calls = [];
  const tts = createTts({
    ...quiet, now: () => t, fetchImpl: okFetch(calls),
    env: { ELEVENLABS_API_KEY: 'k', ELEVENLABS_MAX_CALLS_PER_HOUR: '2' }
  });
  assert.equal((await tts.synth('one', 'x')).status, 200);
  assert.equal((await tts.synth('two', 'x')).status, 200);
  assert.equal((await tts.synth('three', 'x')).status, 503, 'cap reached');
  assert.equal((await tts.synth('one', 'x')).status, 200, 'cached lines are still served');
  t += 3600001;
  assert.equal((await tts.synth('three', 'x')).status, 200, 'an hour later the cap has reset');
  assert.equal(calls.length, 3);
});

test('speech speed defaults to 1.2, is sent as voice_settings.speed and is clamped to 0.7-1.2', async () => {
  const calls = [];
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: okFetch(calls) });
  await tts.synth(LINE);
  assert.equal(JSON.parse(calls[0].init.body).voice_settings.speed, 1.2);
  assert.equal(getConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_SPEED: '1' }).speed, 1);
  assert.equal(getConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_SPEED: '2' }).speed, 1.2);
  assert.equal(getConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_SPEED: '0.1' }).speed, 0.7);
  assert.equal(getConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_SPEED: 'fast' }).speed, 1.2);
});
