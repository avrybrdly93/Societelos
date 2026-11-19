'use strict';

// Societelos - The Loom's spoken voice (ElevenLabs text-to-speech).
//
// The browser asks GET /api/tts?text=... and plays the returned mp3. The API
// key stays on the server (ELEVENLABS_API_KEY, never committed). Every failure
// path (no key, LOOM_OFFLINE, timeout, network down, bad status) resolves to
// null, and the route answers 503, so the host page falls back to the browser's
// built-in voice and the game still runs offline (Offline Demo Mandate).
//
// Only the Loom's authored lines can be voiced: the intro crawl script below
// plus every loomIntro in data/crises.json. That keeps the endpoint from being
// used as a free, open text-to-speech proxy, and bounds the cache.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = 'xzZRXG86mSM3naOyL9fa'; // Rowan - soothing, relaxing, calming
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const TIMEOUT_MS = 8000;

// Must match `spokenScripts` in public/js/host.js (server/test/tts.test.js
// fails if the two drift apart).
const INTRO_LINES = [
  'Transmission. The Loom.',
  'I have automated all labor. Scarcity, disease and toil are solved.',
  'Survival for two hundred fifty thousand citizens is guaranteed.',
  'I cannot compute purpose.',
  'Gross Domestic Well-Being stands at twenty-five percent.',
  'I forecast a ninety-four percent chance of revolt within five years.',
  'I have convened five trustees in secret. You.',
  'Five crises. Five years. Do not let well-being reach zero.'
];

function getConfig(env = process.env) {
  const apiKey = (env.ELEVENLABS_API_KEY || '').trim();
  return {
    apiKey,
    enabled: apiKey.length > 0 && env.LOOM_OFFLINE !== 'true',
    voiceId: (env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID).trim(),
    model: (env.ELEVENLABS_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: TIMEOUT_MS
  };
}

function loadAllowedLines(dataFile = path.join(__dirname, '..', 'data', 'crises.json')) {
  const allowed = new Set(INTRO_LINES);
  try {
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        if (typeof node.loomIntro === 'string' && node.loomIntro.trim()) allowed.add(node.loomIntro.trim());
        Object.values(node).forEach(walk);
      }
    };
    walk(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  } catch (err) {
    console.error('[tts] could not read crises.json for the voice allow-list:', err.message);
  }
  return allowed;
}

/**
 * Create a synthesiser. `deps` exists for tests: { env, fetchImpl, allowed, logger }.
 * synth(text) resolves { status: 200, audio: Buffer } | { status: 403|503 }; it never rejects.
 */
function createTts(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || ((...a) => globalThis.fetch(...a));
  const logger = deps.logger || ((...a) => console.error(...a));
  const allowed = deps.allowed || loadAllowedLines();
  const cache = new Map(); // text -> Promise<Buffer|null> (in flight or done)

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
      return buf.length ? buf : null;
    } catch (err) {
      logger(`[tts] request failed: ${err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || err}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function synth(rawText) {
    const text = String(rawText || '').trim();
    if (!allowed.has(text)) return { status: 403 };
    const cfg = getConfig(env);
    if (!cfg.enabled) return { status: 503 };
    if (!cache.has(text)) cache.set(text, request(text, cfg));
    const audio = await cache.get(text);
    if (!audio) {
      cache.delete(text); // failures are not cached: the next call may succeed
      return { status: 503 };
    }
    return { status: 200, audio };
  }

  return { synth, allowed };
}

module.exports = { createTts, getConfig, loadAllowedLines, INTRO_LINES, DEFAULT_VOICE_ID };
