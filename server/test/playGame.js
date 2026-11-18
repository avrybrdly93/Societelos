'use strict';

// Shared headless game driver for server/test: the real engine, simulation,
// content and Loom module on shrunk phase timers (see playthrough.test.js).

const engine = require('../gameEngine');
const loom = require('../loom');
const { GameState, NODE_IDS } = engine;

/**
 * Play one full game. `world` sets the Cycle 1/2 votes (e.g. 'BA'); cycles
 * 3-5 vote `lateVote(cycle, i)`. Phones write `writeIn(i)` in FINALE_WRITE,
 * rank their ballot in order, and `onEvent` sees every engine event.
 */
function playGame({ gameId, world, lateVote = (cycle, i) => (i < 3 ? 'A' : 'B'), writeIn = (i) => `Council proposal number ${i + 1}`, onEvent = () => {}, phaseSeconds = {}, guardMs = 20000, apiKey = null }) {
  const saved = { fast: process.env.FAST_TIMERS, secs: process.env.FAST_TIMER_SECONDS, key: process.env.GEMINI_API_KEY };
  process.env.FAST_TIMERS = 'true';
  process.env.FAST_TIMER_SECONDS = '0.01';
  // apiKey: play with the Loom "online" (tests stub the network themselves).
  if (apiKey) process.env.GEMINI_API_KEY = apiKey; else delete process.env.GEMINI_API_KEY;
  const game = new GameState({ roomCode: 'PLAY', phaseSeconds });
  const restoreEnv = () => {
    for (const [k, v] of [['FAST_TIMERS', saved.fast], ['FAST_TIMER_SECONDS', saved.secs], ['GEMINI_API_KEY', saved.key]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  game.gameId = gameId;
  const out = { game, phases: [], payloads: [], resolutions: [], reveals: [], intel: [], ballots: [], feedback: [], roles: {}, end: null, gameEnd: null, restoreEnv };
  const log = console.log;
  console.log = () => {};
  NODE_IDS.forEach((node, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(node, true); });
  game.on('role:assigned', ({ node, role }) => { out.roles[node] = role.key; });
  game.on('resolution', (r) => out.resolutions.push(r));
  game.on('world:reveal', (w) => out.reveals.push(w));
  game.on('game:end', (d) => { out.gameEnd = d; });
  game.on('intel:drop', (e) => out.intel.push({ cycle: game.cycle, ...e }));
  game.on('finale:feedback', (f) => { out.feedback.push(f); onEvent('finale:feedback', f, game); });
  game.on('finale:ballot', (b) => {
    out.ballots.push(b);
    setImmediate(() => game.rankPolicies(b.node, b.policies.map((p) => p.id)));
  });
  return new Promise((resolve, reject) => {
    const finish = (fn) => { game.stop(); console.log = log; restoreEnv(); fn(); };
    const guard = setTimeout(() => finish(() => reject(new Error(`stalled: ${out.phases.slice(-4).join(' ')}`))), guardMs);
    game.on('phase', (p) => {
      out.phases.push(`${p.cycle}:${p.phase}`);
      out.payloads.push(p);
      onEvent('phase', p, game);
      if (p.phase === 'VOTE') NODE_IDS.forEach((n, i) => game.castVote(n, p.cycle <= 2 ? world[p.cycle - 1] : lateVote(p.cycle, i)));
      if (p.phase === 'FINALE_WRITE') NODE_IDS.forEach((n, i) => game.submitPolicy(n, writeIn(i)));
      if (p.phase === 'END') {
        clearTimeout(guard);
        out.end = p;
        setImmediate(() => finish(() => resolve(out)));
      }
    });
    game.startIntroPhase();
  });
}

/** A loom.moderate stand-in: every write-in comes back "ok" with distinct tags. */
const TAGS = [['artisan'], ['lotus'], ['ghost'], ['assimilator'], []];
function okModeration(subs) {
  return subs.map((s, i) => ({
    node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: TAGS[i % TAGS.length],
    effects: { purpose: 0.1, connection: 0.05 * i, health: 0.1, trust: 0, fairness: 0, autonomy: -0.05 }
  }));
}

/** Swap loom functions for one test, always restoring them. */
async function withLoom(overrides, fn) {
  const original = {};
  for (const k of Object.keys(overrides)) { original[k] = loom[k]; loom[k] = overrides[k]; }
  try {
    return await fn();
  } finally {
    Object.assign(loom, original);
  }
}

module.exports = { playGame, okModeration, withLoom, TAGS };
