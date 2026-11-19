'use strict';

// Kokoro (free local voice): WAV encoding, the load/ready/fail life cycle, and
// its place behind /api/tts. The model itself is stubbed: these tests never
// download or run it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createKokoro, encodeWav, concatClips } = require('../kokoro');
const { createTts, getProvider } = require('../tts');

const quiet = () => {};
const clip = (n, v = 0.5) => ({ audio: new Float32Array(n).fill(v), sampling_rate: 24000 });

function fakeModule({ fail = false, calls = [] } = {}) {
  return {
    calls,
    importer: async () => ({
      KokoroTTS: {
        from_pretrained: async () => {
          if (fail) throw new Error('offline and not cached');
          return {
            async *stream(text, opts) {
              calls.push({ text, opts });
              yield { audio: clip(100) };
              yield { audio: clip(50) };
            }
          };
        }
      }
    })
  };
}
const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('encodeWav writes a valid 16-bit mono PCM header and clamps samples', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 2, -2]), 24000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 24000, 'sample rate');
  assert.equal(wav.readUInt16LE(34), 16, 'bits');
  assert.equal(wav.readUInt32LE(40), 10, 'data bytes');
  assert.equal(wav.length, 44 + 10);
  assert.equal(wav.readInt16LE(46), 32767);
  assert.equal(wav.readInt16LE(48), -32768);
  assert.equal(wav.readInt16LE(50), 32767, 'clamped above 1');
  assert.equal(wav.readInt16LE(52), -32768, 'clamped below -1');
});

test('concatClips joins sentence clips with a pause between them', () => {
  const out = concatClips([clip(10, 1), clip(20, 0.5)], 0.001); // 24 samples of silence
  assert.equal(out.audio.length, 10 + 24 + 20);
  assert.equal(out.audio[0], 1);
  assert.equal(out.audio[15], 0, 'silence');
  assert.equal(out.audio[40], 0.5);
});

test('not ready until the model has loaded; then it speaks with the chosen voice and speed', async () => {
  const mod = fakeModule();
  const k = createKokoro({ env: { KOKORO_VOICE: 'am_michael', KOKORO_SPEED: '0.9' }, logger: quiet, importer: mod.importer });
  assert.equal(await k.generate('hello'), null, 'first call only starts loading');
  await until(() => k.isReady());
  assert.ok(k.isReady());
  const wav = await k.generate('I cannot compute purpose.');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.deepEqual(mod.calls[0].opts, { voice: 'am_michael', speed: 0.9 });
});

test('a failed load answers null (browser voice) and retries only after a cool-down', async () => {
  let t = 0;
  let loads = 0;
  const importer = async () => { loads++; return fakeModule({ fail: true }).importer(); };
  const k = createKokoro({ env: {}, logger: quiet, importer, now: () => t });
  await k.generate('x');
  await until(() => loads === 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(k.isReady(), false);
  assert.equal(await k.generate('x'), null);
  assert.equal(loads, 1, 'no retry inside the cool-down');
  t += 61000;
  await k.generate('x');
  assert.equal(loads, 2, 'retries after the cool-down');
});

test('TTS_PROVIDER picks the engine; with no setting it follows the ElevenLabs key', () => {
  assert.equal(getProvider({}), 'off');
  assert.equal(getProvider({ ELEVENLABS_API_KEY: 'k' }), 'elevenlabs');
  assert.equal(getProvider({ TTS_PROVIDER: 'kokoro', ELEVENLABS_API_KEY: 'k' }), 'kokoro');
  assert.equal(getProvider({ TTS_PROVIDER: 'OFF', ELEVENLABS_API_KEY: 'k' }), 'off');
  assert.equal(getProvider({ TTS_PROVIDER: 'nonsense' }), 'off');
});

test('/api/tts with Kokoro: 503 while the model loads, then audio/wav, cached, and no network use', async () => {
  let ready = false;
  const generated = [];
  const kokoro = {
    isReady: () => ready,
    warm: () => {},
    generate: async (text) => { generated.push(text); return Buffer.from('RIFFfake'); }
  };
  const fetchImpl = async () => { throw new Error('Kokoro must not use the network'); };
  const tts = createTts({ ...quiet, kokoro, fetchImpl, env: { TTS_PROVIDER: 'kokoro' } });
  assert.equal((await tts.synth('I cannot compute purpose.')).status, 503, 'loading');
  ready = true;
  const out = await tts.synth('I cannot compute purpose.');
  assert.equal(out.status, 200);
  assert.equal(out.type, 'audio/wav');
  await tts.synth('I cannot compute purpose.');
  assert.equal(generated.length, 1, 'cached');
});

test('Kokoro ignores LOOM_OFFLINE (it is local) and needs no key', async () => {
  const kokoro = { isReady: () => true, warm: () => {}, generate: async () => Buffer.from('RIFFfake') };
  const tts = createTts({ ...quiet, kokoro, env: { TTS_PROVIDER: 'kokoro', LOOM_OFFLINE: 'true' } });
  assert.equal((await tts.synth('hello there')).status, 200);
});

test('a Kokoro error on a line answers 503 and is not cached', async () => {
  let fail = true;
  const kokoro = { isReady: () => true, warm: () => {}, generate: async () => (fail ? null : Buffer.from('RIFFok')) };
  const tts = createTts({ ...quiet, kokoro, env: { TTS_PROVIDER: 'kokoro' } });
  assert.equal((await tts.synth('line one')).status, 503);
  fail = false;
  assert.equal((await tts.synth('line one')).status, 200);
});

test('a line that hangs is given up on, and the lines after it still get spoken', async () => {
  let first = true;
  const importer = async () => ({
    KokoroTTS: {
      from_pretrained: async () => ({
        async *stream() {
          if (first) { first = false; await new Promise(() => {}); } // never finishes
          yield { audio: clip(10) };
        }
      })
    }
  });
  const k = createKokoro({ env: { KOKORO_TIMEOUT_MS: '30' }, logger: quiet, importer });
  await k.generate('warm');
  await until(() => k.isReady());
  assert.equal(await k.generate('stuck line'), null, 'timed out');
  const wav = await k.generate('next line');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', 'the queue is not blocked');
});
