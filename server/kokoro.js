'use strict';

// Societelos - the Loom's voice, free and local: Kokoro-82M text-to-speech.
//
// Runs on the machine that runs the game server (the classroom laptop), with no
// API key and no per-use cost. The ~90 MB model is downloaded once on first
// start and cached on disk, after which it works with no internet (Offline Demo
// Mandate). Until it is loaded, or if it cannot load, generate() resolves null
// and the host page uses the browser's built-in voice.
//
// kokoro-js is an optional dependency (large: ONNX runtime), loaded lazily, so
// deployments that never set TTS_PROVIDER=kokoro (Render) never touch it.

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'bm_george'; // calm British male; try am_michael, bm_lewis, af_heart...
const DEFAULT_SPEED = 0.95;
const RETRY_AFTER_MS = 60000;
const DEFAULT_TIMEOUT_MS = 20000; // a line that takes longer is given up on (browser voice)

/** Float32 samples (-1..1) -> 16-bit PCM mono WAV file (Buffer). */
function encodeWav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

/** Join sentence clips into one, with a short pause between them. */
function concatClips(clips, pauseSeconds = 0.18) {
  const rate = clips[0].sampling_rate;
  const gap = Math.round(rate * pauseSeconds);
  const total = clips.reduce((n, c) => n + c.audio.length, 0) + gap * (clips.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  clips.forEach((c, i) => {
    out.set(c.audio, at);
    at += c.audio.length + (i < clips.length - 1 ? gap : 0);
  });
  return { audio: out, sampling_rate: rate };
}

/**
 * `deps` exists for tests: { env, logger, importer, now }. `importer()` resolves
 * the kokoro-js module namespace ({ KokoroTTS }).
 */
function createKokoro(deps = {}) {
  const env = deps.env || process.env;
  const logger = deps.logger || ((...a) => console.log(...a));
  const importer = deps.importer || (() => import('kokoro-js'));
  const now = deps.now || Date.now;
  const voice = (env.KOKORO_VOICE || DEFAULT_VOICE).trim();
  const speed = Number(env.KOKORO_SPEED) > 0 ? Number(env.KOKORO_SPEED) : DEFAULT_SPEED;

  const timeoutMs = Number(env.KOKORO_TIMEOUT_MS) > 0 ? Number(env.KOKORO_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  let state = 'idle'; // idle | loading | ready | failed
  let model = null;
  let failedAt = 0;
  let queue = Promise.resolve(); // one synthesis at a time: it is CPU-bound

  function warm() {
    if (state === 'loading' || state === 'ready') return;
    state = 'loading';
    logger('[tts] Kokoro: loading the voice model (first run downloads ~90 MB, then it is cached)...');
    (async () => {
      const { KokoroTTS } = await importer();
      model = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' });
      state = 'ready';
      logger(`[tts] Kokoro ready (voice ${voice}).`);
    })().catch((err) => {
      state = 'failed';
      failedAt = now();
      logger(`[tts] Kokoro could not load, so the browser voice is used: ${(err && err.message) || err}`);
    });
  }

  /** WAV Buffer, or null while the model is not ready / on any error. Never rejects. */
  function generate(text) {
    if (state === 'failed' && now() - failedAt > RETRY_AFTER_MS) warm();
    else if (state === 'idle') warm();
    if (state !== 'ready') return Promise.resolve(null);
    const job = queue.then(() => {
      let timer;
      const work = (async () => {
        try {
          const clips = [];
          for await (const chunk of model.stream(text, { voice, speed })) clips.push(chunk.audio);
          if (!clips.length) return null;
          const { audio, sampling_rate } = concatClips(clips);
          return encodeWav(audio, sampling_rate);
        } catch (err) {
          logger(`[tts] Kokoro failed on a line: ${(err && err.message) || err}`);
          return null;
        }
      })();
      // A stuck line must not block every line after it.
      const limit = new Promise((resolve) => {
        timer = setTimeout(() => {
          logger(`[tts] Kokoro took over ${timeoutMs / 1000}s on a line; giving up on it (browser voice).`);
          resolve(null);
        }, timeoutMs);
      });
      return Promise.race([work, limit]).finally(() => clearTimeout(timer));
    });
    queue = job.then(() => undefined, () => undefined);
    return job;
  }

  return { warm, generate, isReady: () => state === 'ready', voice };
}

module.exports = { createKokoro, encodeWav, concatClips, MODEL_ID, DEFAULT_VOICE };
