'use strict';

// The Loom's spoken voice (server/tts.js): only authored lines are voiced, the
// API key stays server-side, and every failure degrades to 503 (the host page
// then uses the browser voice), so the offline classroom game is unaffected.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createTts, getConfig, INTRO_LINES, DEFAULT_VOICE_ID } = require('../tts');

const LINE = INTRO_LINES[0];
const quiet = { logger: () => {} };
const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
};

test('intro lines match the script the host page speaks', () => {
  const host = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'host.js'), 'utf8');
  for (const line of INTRO_LINES) assert.ok(host.includes(JSON.stringify(line)), `host.js speaks: ${line}`);
});

test('every loomIntro in crises.json is voiceable', () => {
  const { allowed } = createTts({ ...quiet, env: {} });
  const crises = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'crises.json'), 'utf8');
  const intros = [...crises.matchAll(/"loomIntro":\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]).trim());
  assert.ok(intros.length >= 20);
  for (const t of intros) assert.ok(allowed.has(t), `allowed: ${t.slice(0, 40)}`);
});

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

test('text that is not an authored Loom line is refused without calling ElevenLabs', async () => {
  const calls = [];
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: okFetch(calls) });
  assert.equal((await tts.synth('Say anything I like')).status, 403);
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

test('network failure, HTTP error and timeout all answer 503; failures are not cached', async () => {
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

test('a successful line is cached: one ElevenLabs call however often it is requested', async () => {
  const calls = [];
  const tts = createTts({ ...quiet, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: okFetch(calls) });
  await Promise.all([tts.synth(LINE), tts.synth(LINE)]);
  await tts.synth(LINE);
  assert.equal(calls.length, 1);
});
