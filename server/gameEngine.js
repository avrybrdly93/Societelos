'use strict';

// Societelos — Stream 1 authoritative game state machine.
// The server is the only source of truth: this module owns game state and
// phase timers. socket.js translates client events into calls on it.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** Read and parse one JSON file, returning `fallback` if missing or invalid. */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[gameEngine] could not load ${path.basename(file)}: ${err.message}`);
    return fallback;
  }
}

/**
 * Load content on startup: crises, roles and citizens from /data.
 * Never throws, so a broken content file can't take the server down.
 */
function loadGameData(dataDir = DATA_DIR) {
  return {
    crises: readJson(path.join(dataDir, 'crises.json'), { fixedCrises: [], worlds: {} }),
    roles: readJson(path.join(dataDir, 'roles.json'), []),
    citizens: readJson(path.join(dataDir, 'citizens.json'), [])
  };
}

// Room codes: 4 uppercase letters, without the easily confused O and I
// (digits are never used, so 0 and 1 cannot appear either).
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 4;

// The five player slots. Phones are mapped to these ids; student names never
// leave the server and are never written to logs.
const NODE_IDS = Object.freeze(['NODE-01', 'NODE-02', 'NODE-03', 'NODE-04', 'NODE-05']);
const MAX_PLAYERS = NODE_IDS.length;

/**
 * Generate a 4-letter room code not present in `taken` (a Set or Map of codes).
 */
function generateRoomCode(taken = new Set()) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!taken.has(code)) return code;
  }
  throw new Error('Unable to allocate a free room code');
}

/**
 * Unique game id (12 hex chars). Shown on the end screen so a class can replay
 * a game: every seed in the game is derived from it.
 */
function generateGameId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Deterministic 32-bit seed from a game id and any extra parts (e.g. cycle),
 * using FNV-1a. hashSeed(gameId, 3) is always the same number.
 */
function hashSeed(gameId, ...parts) {
  const input = [gameId, ...parts].join(':');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32 seeded PRNG: returns a function producing floats in [0, 1).
 * The engine never uses Math.random(), so a game is replayable from its id.
 */
function createPrng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle of a copy of `items` driven by a seeded PRNG. */
function seededShuffle(items, seed) {
  const rand = createPrng(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Stable short key for a role: 'artisan' | 'lotus' | 'assimilator' | 'catalyst' | 'ghost'.
 * Accepts both the spec schema ({ id: 'artisan', name }) and the legacy one
 * ({ id: 'NODE-01', designation: 'The Artisan' }).
 */
function roleKey(role) {
  if (role.key) return role.key;
  const label = String(role.id && !/^NODE-/.test(role.id) ? role.id : role.name || role.designation || '').toLowerCase();
  if (label.includes('lotus')) return 'lotus';
  for (const key of ['artisan', 'assimilator', 'catalyst', 'ghost']) {
    if (label.includes(key)) return key;
  }
  return label.replace(/^the\s+/, '').replace(/[^a-z]+/g, '-');
}

// ---------------------------------------------------------------------------
// Stream 4 interface stubs. Until server/sim and server/loom.js expose the
// agreed interfaces, the engine falls back to these so a cycle stays playable.
// ---------------------------------------------------------------------------

const MONTHS_PER_CYCLE = 12;

/**
 * Stub for simulate(state, effects, { runs, seed }).
 * Returns a flat line at current GDW + 5 for both forecast and realized run.
 */
function simulateStub(state, effects, { runs = 500, seed = 0 } = {}) {
  const startGdw = typeof state?.gdw === 'number' ? state.gdw : 25;
  const endGdw = Math.max(0, Math.min(100, startGdw + 5));
  const line = Array.from({ length: MONTHS_PER_CYCLE + 1 }, (_, m) => (m === 0 ? startGdw : endGdw));
  return {
    forecast: {
      runs,
      median: line.slice(),
      p5: line.slice(),
      p95: line.slice(),
      pCollapse: 0,
      pUnrest: endGdw < 15 ? 1 : 0
    },
    realized: { seed, gdw: line.slice(), finalGdw: endGdw, districts: [] },
    finalState: { ...(state || {}), gdw: endGdw },
    summary: { realizedDelta: endGdw - startGdw, medianDelta: endGdw - startGdw, pCollapse: 0, topMoves: [], shocks: [], stub: true }
  };
}

/** Resolve the real simulate() from server/sim when it exists, else the stub. */
function resolveSimulate() {
  try {
    const sim = require('./sim');
    if (sim && typeof sim.simulate === 'function') return sim.simulate;
  } catch (err) {
    // server/sim/index.js not merged yet.
  }
  return simulateStub;
}

/**
 * Stub for server/loom.js: canned JSON for narrate() and moderate().
 * Both are async to match the real Gemini-backed interface.
 */
const loomStub = {
  async narrate(context = {}) {
    const delta = context.summary?.realizedDelta ?? 0;
    const loomLine = delta >= 0
      ? 'The council has decided. Wellbeing indicators are rising. I will continue to observe.'
      : 'The council has decided. Wellbeing indicators are falling. I will continue to observe.';
    return {
      loomLine,
      messages: [
        { citizenId: 'mara', text: delta >= 0 ? 'Felt useful today for the first time in months.' : 'Nobody asked us. Again.' },
        { citizenId: 'tomas', text: delta >= 0 ? 'Fine. I admit it. Things are slightly less terrible.' : 'Great. Another genius decision from the people upstairs.' }
      ],
      stub: true
    };
  },
  async moderate(submissions = []) {
    return submissions.map((s) => ({
      node: s.node,
      status: 'ok',
      cleaned: String(s.text || '').trim().slice(0, 140),
      feedback: '',
      roles: [],
      effects: { purpose: 0, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 },
      stub: true
    }));
  }
};

/** Resolve the real Loom module when it exposes narrate/moderate, else the stub. */
function resolveLoom() {
  try {
    const loom = require('./loom');
    if (loom && typeof loom.narrate === 'function' && typeof loom.moderate === 'function') return loom;
  } catch (err) {
    // server/loom.js not merged yet.
  }
  return loomStub;
}

/**
 * State for one game room (one projector + 5 phones).
 */
class GameState {
  constructor({ roomCode = null } = {}) {
    this.roomCode = roomCode;
    this.gameId = generateGameId();
    this.createdAt = Date.now();

    // Players keyed by node id ('NODE-01'..'NODE-05').
    this.players = {};

    // Phase state machine.
    this.phase = null;
    this.endsAt = null;
    this.cycle = 0;

    // Society.
    this.gdw = 25;
    this.gdwHistory = [];
    this.volatility = 1.0;
    this.worldKey = null;
    this.choices = {}; // cycle number -> winning option ('A' | 'B')

    // Current cycle.
    this.crisis = null;
    this.votes = {}; // node id -> { choice, override }
    this.lastResolution = null;

    // Scoring.
    this.scores = {};
    this.overridesUsed = {};
  }

  /**
   * Seat a joining phone in the first free NODE slot.
   * The display name stays on the server (end screen only); logs use the node id.
   * Returns { ok: true, node } or { ok: false, reason }.
   */
  addPlayer(socketId, name) {
    const node = NODE_IDS.find((id) => !this.players[id]);
    if (!node) return { ok: false, reason: 'ROOM_FULL' };

    const cleanName = String(name || '').trim().slice(0, 24) || node;
    this.players[node] = {
      node,
      socketId,
      name: cleanName,
      ready: false,
      connected: true,
      role: null,
      joinedAt: Date.now()
    };
    this.scores[node] = 0;
    this.overridesUsed[node] = false;
    console.log(`[game ${this.roomCode}] ${node} joined`);
    return { ok: true, node };
  }

  /**
   * Set (or toggle, when `ready` is omitted) a player's ready flag.
   * Returns the new value, or null for an unknown node.
   */
  setReady(node, ready) {
    const player = this.players[node];
    if (!player) return null;
    player.ready = typeof ready === 'boolean' ? ready : !player.ready;
    return player.ready;
  }

  /** Number of seated players currently marked ready. */
  readyCount() {
    return Object.values(this.players).filter((p) => p.ready).length;
  }

  /** True once all 5 slots are filled and all 5 players are ready. */
  allReady() {
    return Object.keys(this.players).length === MAX_PLAYERS && this.readyCount() === MAX_PLAYERS;
  }

  /**
   * Secretly deal the 5 roles to the 5 nodes with a shuffle seeded from the
   * game id. Returns { node: role } where each role carries a `key`.
   */
  assignRoles(roles) {
    if (!Array.isArray(roles) || roles.length < MAX_PLAYERS) {
      throw new Error(`assignRoles needs ${MAX_PLAYERS} roles`);
    }
    const dealt = seededShuffle(roles.slice(0, MAX_PLAYERS), hashSeed(this.gameId, 'roles'));
    const assignment = {};
    NODE_IDS.forEach((node, i) => {
      const role = { ...dealt[i], key: roleKey(dealt[i]) };
      assignment[node] = role;
      if (this.players[node]) this.players[node].role = role;
    });
    this.roleAssignment = assignment;
    return assignment;
  }

  /** Find the node id a socket is seated at, or null. */
  findNodeBySocket(socketId) {
    const player = Object.values(this.players).find((p) => p.socketId === socketId);
    return player ? player.node : null;
  }
}

module.exports = {
  GameState,
  loadGameData,
  generateRoomCode,
  generateGameId,
  hashSeed,
  createPrng,
  seededShuffle,
  roleKey,
  simulateStub,
  resolveSimulate,
  loomStub,
  resolveLoom,
  ROOM_CODE_ALPHABET,
  NODE_IDS,
  MAX_PLAYERS
};
