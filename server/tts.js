'use strict';

// Societelos - The Loom's spoken voice.
//
// Two providers behind one endpoint, chosen by TTS_PROVIDER:
//   kokoro      free, runs on this machine (server/kokoro.js), works offline once
//               its model is cached, no key or cost
//   elevenlabs  paid cloud voice (default when ELEVENLABS_API_KEY is set)
//   off         browser voice only
// 
// The host page asks GET /api/tts?text=... for each line the Loom speaks (intro,
// briefing, incidents, verdicts - some written live by Gemini) and plays the
// returned mp3. The API key stays on the server (ELEVENLABS_API_KEY, never
// committed). Every failure path (no key, LOOM_OFFLINE, timeout, network down,
// bad status, limits) answers 503, and the host page then falls back to the
// browser's built-in voice, so the game still runs offline (Offline Demo Mandate).
//
// Because the text is not a fixed list, the endpoint is bounded instead:
// a length cap per line, a per-client rate limit, a global cap on uncached
// ElevenLabs calls per hour (spend guard) and a bounded cache.

const { createKokoro } = require('./kokoro');

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = 'xzZRXG86mSM3naOyL9fa'; // Rowan - soothing, relaxing, calming
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const TIMEOUT_MS = 8000;
const MAX_TEXT = 600;              // longest authored line is ~150 chars; Gemini lines are capped near 200
const CLIENT_LIMIT_PER_MIN = 60;   // one host prefetches ~15 lines at once
const DEFAULT_MAX_CALLS_PER_HOUR = 400;
const CACHE_MAX = 300;

function getProvider(env = process.env) {
  const explicit = (env.TTS_PROVIDER || '').trim().toLowerCase();
  if (['kokoro', 'elevenlabs', 'off'].includes(explicit)) return explicit;
  return (env.ELEVENLABS_API_KEY || '').trim() ? 'elevenlabs' : 'off';
}

function getConfig(env = process.env) {
  const apiKey = (env.ELEVENLABS_API_KEY || '').trim();
  const cap = Number(env.ELEVENLABS_MAX_CALLS_PER_HOUR);
  return {
    provider: getProvider(env),
    apiKey,
    enabled: apiKey.length > 0 && env.LOOM_OFFLINE !== 'true',
    voiceId: (env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID).trim(),
    model: (env.ELEVENLABS_MODEL || DEFAULT_MODEL).trim(),
    maxCallsPerHour: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_CALLS_PER_HOUR,
    timeoutMs: TIMEOUT_MS
  };
}

/**
 * Create a synthesiser. `deps` exists for tests: { env, fetchImpl, logger, now, kokoro }.
 * synth(text, clientId) resolves { status: 200, audio, type } | { status: 400|429|503 }; it never rejects.
 */
function createTts(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || ((...a) => globalThis.fetch(...a));
  const logger = deps.logger || ((...a) => console.error(...a));
  const now = deps.now || Date.now;
  let kokoro = deps.kokoro || null; // created on first use, so ElevenLabs-only setups never load it
  const getKokoro = () => (kokoro = kokoro || createKokoro({ env, logger: deps.logger }));
  const cache = new Map();        // text -> Promise<{ audio, type } | null>, oldest first
  const clientHits = new Map();   // clientId -> request timestamps in the last minute
  let callTimes = [];             // uncached ElevenLabs calls in the last hour

  function rateLimited(clientId) {
    const t = now();
    const hits = (clientHits.get(clientId) || []).filter((x) => t - x < 60000);
    hits.push(t);
    clientHits.set(clientId, hits);
    if (clientHits.size > 500) clientHits.delete(clientHits.keys().next().value);
    return hits.length > CLIENT_LIMIT_PER_MIN;
  }

  async function request(text, cfg) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetchImpl(`${API_BASE}/${encodeURIComponent(cfg.voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: cfg.model }),
        signal: controller.signal
      });
      if (!res.ok) {
        logger(`[tts] ElevenLabs answered HTTP ${res.status}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length ? { audio: buf, type: 'audio/mpeg' } : null;
    } catch (err) {
      logger(`[tts] request failed: ${err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || err}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function synth(rawText, clientId = 'local') {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text || text.length > MAX_TEXT) return { status: 400 };
    const cfg = getConfig(env);
    if (cfg.provider === 'off') return { status: 503 };
    if (cfg.provider === 'elevenlabs' && !cfg.enabled) return { status: 503 };
    if (rateLimited(clientId)) return { status: 429 };

    if (!cache.has(text)) {
      if (cfg.provider === 'kokoro') {
        const k = getKokoro();
        if (!k.isReady()) { k.warm(); return { status: 503 }; } // still loading: browser voice for now
        cache.set(text, k.generate(text).then((audio) => (audio ? { audio, type: 'audio/wav' } : null)));
      } else {
        const t = now();
        callTimes = callTimes.filter((x) => t - x < 3600000);
        if (callTimes.length >= cfg.maxCallsPerHour) {
          logger('[tts] hourly ElevenLabs call cap reached; using browser voice');
          return { status: 503 };
        }
        callTimes.push(t);
        cache.set(text, request(text, cfg));
      }
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    const clip = await cache.get(text);
    if (!clip) {
      cache.delete(text); // failures are not cached: the next call may succeed
      return { status: 503 };
    }
    return { status: 200, audio: clip.audio, type: clip.type };
  }

  // Start loading the Kokoro model in the background (called once at server start).
  function warm() {
    if (getConfig(env).provider === 'kokoro') getKokoro().warm();
  }

  return { synth, warm };
}

module.exports = { createTts, getConfig, getProvider, DEFAULT_VOICE_ID, MAX_TEXT, CLIENT_LIMIT_PER_MIN };
