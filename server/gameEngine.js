'use strict';

// Societelos — Stream 1 authoritative game state machine.
// The server is the only source of truth: this module owns game state and
// phase timers. socket.js translates client events into calls on it.

const crypto = require('crypto');
const { EventEmitter } = require('events');
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

// Phase state machine. These strings are part of the socket contract.
const PHASES = Object.freeze({
  LOBBY: 'LOBBY',
  INTRO: 'INTRO',
  ROLE_ASSIGN: 'ROLE_ASSIGN',
  CHAMBER: 'CHAMBER',
  INCIDENT: 'INCIDENT',
  INTEL: 'INTEL',
  DEBATE: 'DEBATE',
  VOTE: 'VOTE',
  RESOLUTION: 'RESOLUTION',
  WORLD_REVEAL: 'WORLD_REVEAL',
  FINALE_WRITE: 'FINALE_WRITE',
  FINALE_MOD: 'FINALE_MOD',
  FINALE_DEBATE: 'FINALE_DEBATE',
  FINALE_RANK: 'FINALE_RANK',
  FINALE_ENACT: 'FINALE_ENACT',
  END: 'END'
});

const TOTAL_CYCLES = 5;
const STARTING_GDW = 25;
const FALLBACK_INTEL = 'The Loom archive returned no new research for your role this cycle. Argue from your agenda.';

// The region revealed in the Council Chamber (250,000 citizens, 5 districts).
// Display data only; the simulation's tunables live in data/sim.json.
const REGION = Object.freeze({
  population: 250000,
  districts: Object.freeze([
    { id: 'D1', name: 'Old Harbour', population: 30000 },
    { id: 'D2', name: 'The Grid', population: 55000 },
    { id: 'D3', name: 'Riverside', population: 65000 },
    { id: 'D4', name: 'Eastworks', population: 60000 },
    { id: 'D5', name: 'Highlands', population: 40000 }
  ])
});

// Phases with dedicated entry logic -> GameState method name.
const PHASE_STARTERS = {
  INTRO: 'startIntroPhase',
  ROLE_ASSIGN: 'startRoleAssignmentPhase',
  CHAMBER: 'startCouncilChamberPhase',
  INCIDENT: 'startIncidentPhase',
  INTEL: 'startIntelDropPhase'
};

// Phase lengths in seconds (MVP spec). Debate is 90 s (~16 min game) or 60 s
// (~13.5 min game) via DEBATE_SECONDS. LOBBY and END have no timer.
const DEFAULT_PHASE_SECONDS = Object.freeze({
  INTRO: 30,
  ROLE_ASSIGN: 20,
  CHAMBER: 10,
  INCIDENT: 15,
  INTEL: 20,
  DEBATE: 90,
  VOTE: 15,
  RESOLUTION: 20,
  WORLD_REVEAL: 10,
  FINALE_WRITE: 45,
  FINALE_MOD: 10,
  FINALE_DEBATE: 60,
  FINALE_RANK: 30,
  FINALE_ENACT: 20
});

/**
 * Build the phase duration dictionary in milliseconds.
 * `overrides` (seconds) win over env, env wins over defaults.
 */
function buildPhaseDurations(env = process.env, overrides = {}) {
  const seconds = { ...DEFAULT_PHASE_SECONDS };
  const debate = Number(env.DEBATE_SECONDS);
  if (Number.isFinite(debate) && debate > 0) seconds.DEBATE = debate;
  Object.assign(seconds, overrides);
  const ms = {};
  for (const [phase, s] of Object.entries(seconds)) ms[phase] = Math.round(s * 1000);
  return ms;
}

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
// Crisis selection. Accepts both the frozen spec schema (an array of entries
// with world/cycle/options/intel) and the legacy one ({ fixedCrises, worlds })
// and normalises to one shape:
//   { id, world, cycle, title, subtitle, incident, loomIntro, mode, feed,
//     options: { A, B }, intel: { roleKey: text } }
// ---------------------------------------------------------------------------

function normalizeOption(raw, key) {
  if (!raw) return null;
  return {
    key,
    text: raw.text || raw.summary || raw.name || '',
    name: raw.name || raw.text || `Policy ${key}`,
    summary: raw.summary || raw.text || '',
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    effects: raw.effects || {},
    effectsByWorld: raw.effectsByWorld || null,
    volatility: typeof raw.volatility === 'number' ? raw.volatility : null,
    loomLine: raw.loomLine || null,
    reactions: raw.reactions || []
  };
}

function normalizeIntel(raw, roles) {
  const intel = {};
  if (!raw) return intel;
  for (const [k, v] of Object.entries(raw)) {
    // Legacy intel is keyed by node id, whose role was fixed in roles.json.
    const legacyRole = /^NODE-/.test(k) ? roles.find((r) => r.id === k) : null;
    const key = legacyRole ? roleKey(legacyRole) : k;
    intel[key] = typeof v === 'string' ? v : [v.concept, v.quote].filter(Boolean).join(': ');
  }
  return intel;
}

function normalizeCrisis(raw, { world, cycle, mode, roles = [] }) {
  if (!raw) return null;
  const options = raw.options || {
    A: raw.policyA || raw.fallbackPolicyA,
    B: raw.policyB || raw.fallbackPolicyB
  };
  return {
    id: raw.id,
    world: raw.world || world,
    cycle: raw.cycle || cycle,
    title: raw.title,
    subtitle: raw.subtitle || '',
    incident: raw.incident || raw.description || '',
    loomIntro: raw.loomIntro || '',
    teacherPrompt: raw.teacherPrompt || '',
    mode: raw.mode || mode,
    feed: raw.feed || [],
    options: { A: normalizeOption(options.A, 'A'), B: normalizeOption(options.B, 'B') },
    intel: normalizeIntel(raw.intel || raw.intelDrops, roles)
  };
}

/**
 * Pick the crisis for a cycle: cycles 1-2 are fixed, 3-4 come from the
 * world (vote1 + vote2), and 5 is the world's write-in finale.
 */
function selectCrisis(crises, cycle, worldKey, roles = []) {
  const world = cycle <= 2 ? 'fixed' : worldKey;
  const mode = cycle === TOTAL_CYCLES ? 'writein' : 'binary';
  let raw = null;
  if (Array.isArray(crises)) {
    raw = crises.find((c) => c.world === world && c.cycle === cycle) || null;
  } else if (crises) {
    if (cycle <= 2) raw = (crises.fixedCrises || [])[cycle - 1];
    else if (crises.worlds && crises.worlds[worldKey]) {
      const w = crises.worlds[worldKey];
      raw = cycle === TOTAL_CYCLES ? w.finale : (w.crises || [])[cycle - 3];
    }
  }
  return normalizeCrisis(raw, { world, cycle, mode, roles });
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
 * Emits events ('phase', ...) that socket.js relays to clients.
 */
class GameState extends EventEmitter {
  constructor({ roomCode = null, phaseSeconds = {}, data = null } = {}) {
    super();
    this.roomCode = roomCode;
    this.data = data || loadGameData();
    this.gameId = generateGameId();
    this.createdAt = Date.now();

    // Players keyed by node id ('NODE-01'..'NODE-05').
    this.players = {};

    // Phase state machine.
    this.durations = buildPhaseDurations(process.env, phaseSeconds);
    this.phase = PHASES.LOBBY;
    this.endsAt = null;
    this.phaseTimer = null;
    this.cycle = 0;

    // Society.
    this.gdw = STARTING_GDW;
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
   * Authoritative server timer. Sets `endsAt = Date.now() + durationMs` (the
   * timestamp clients count down to) and calls `onExpire` when it passes.
   * Returns endsAt, or null when the phase has no duration.
   */
  startPhaseTimer(durationMs, onExpire) {
    this.clearPhaseTimer();
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      this.endsAt = null;
      return null;
    }
    this.endsAt = Date.now() + durationMs;
    const token = (this.timerToken = (this.timerToken || 0) + 1);
    this.phaseTimer = setTimeout(() => {
      // Ignore a stale callback if the timer was replaced or cleared meanwhile.
      if (token !== this.timerToken) return;
      this.phaseTimer = null;
      onExpire();
    }, durationMs);
    return this.endsAt;
  }

  /**
   * Cancel the pending phase timer so an early advance (e.g. all votes in)
   * can never be followed by a second, duplicate transition.
   */
  clearPhaseTimer() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.timerToken = (this.timerToken || 0) + 1;
    this.endsAt = null;
  }

  /**
   * Which phase follows the current one. Encodes the game loop:
   * setup -> cycles 1-4 (binary) -> world reveal after cycle 2 -> cycle 5 finale -> end.
   */
  nextPhase() {
    const P = PHASES;
    switch (this.phase) {
      case P.LOBBY: return P.INTRO;
      case P.INTRO: return P.ROLE_ASSIGN;
      case P.ROLE_ASSIGN: return P.CHAMBER;
      case P.CHAMBER: return P.INCIDENT;
      case P.INCIDENT: return this.isFinaleWriteIn() ? P.FINALE_WRITE : P.INTEL;
      case P.INTEL: return P.DEBATE;
      case P.DEBATE: return P.VOTE;
      case P.VOTE: return P.RESOLUTION;
      case P.RESOLUTION:
        if (this.gdw <= 0 || this.cycle >= TOTAL_CYCLES) return P.END;
        return this.cycle === 2 ? P.WORLD_REVEAL : P.INCIDENT;
      case P.WORLD_REVEAL: return P.INCIDENT;
      case P.FINALE_WRITE: return P.FINALE_MOD;
      case P.FINALE_MOD: return P.FINALE_DEBATE;
      case P.FINALE_DEBATE: return P.FINALE_RANK;
      case P.FINALE_RANK: return P.FINALE_ENACT;
      case P.FINALE_ENACT: return P.END;
      default: return P.END;
    }
  }

  /** True when the current cycle is the write-and-rank finale. */
  isFinaleWriteIn() {
    return this.cycle === TOTAL_CYCLES && !this.finaleFallback;
  }

  /**
   * Transition controller: move to the next phase and run its entry logic.
   * Phase-specific starters (start*Phase) are looked up in PHASE_STARTERS;
   * any phase without one just gets its timer and a broadcast.
   */
  advancePhase() {
    const from = this.phase;
    const to = this.nextPhase();
    this.clearPhaseTimer();
    if (from === PHASES.END) return to;
    // A cycle begins at each INCIDENT reached from setup, a resolution or the world reveal.
    if (to === PHASES.INCIDENT && from !== PHASES.INCIDENT) {
      this.startCycle(from === PHASES.CHAMBER ? 1 : this.cycle + 1);
    }
    const starter = PHASE_STARTERS[to];
    if (starter && typeof this[starter] === 'function') {
      this[starter]();
    } else {
      this.enterPhase(to);
    }
    return to;
  }

  /**
   * Generic phase entry: set the phase, start its timer (expiry advances the
   * machine) and broadcast { cycle, phase, endsAt, crisis }.
   */
  enterPhase(phase, extra = {}) {
    this.phase = phase;
    const endsAt = this.startPhaseTimer(this.durations[phase], () => this.advancePhase());
    this.emit('phase', { cycle: this.cycle, phase, endsAt, crisis: this.publicCrisis(), ...extra });
    return endsAt;
  }

  /**
   * INCIDENT: pick this cycle's crisis (Fixed Crisis 1 in cycle 1) and show
   * the incident on the projector.
   */
  startIncidentPhase() {
    this.crisis = selectCrisis(this.data.crises, this.cycle, this.worldKey, this.data.roles);
    if (!this.crisis) console.error(`[game ${this.roomCode}] no crisis for cycle ${this.cycle}`);
    this.enterPhase(PHASES.INCIDENT);
  }

  /**
   * INTEL: emit one private 'intel:drop' ({ node, text }) per node, chosen by
   * that node's secret role.
   */
  startIntelDropPhase() {
    const intel = (this.crisis && this.crisis.intel) || {};
    for (const node of NODE_IDS) {
      const role = this.roleAssignment && this.roleAssignment[node];
      const text = (role && intel[role.key]) || FALLBACK_INTEL;
      this.emit('intel:drop', { node, text });
    }
    this.enterPhase(PHASES.INTEL);
  }

  /**
   * LOBBY -> INTRO, triggered by the host. Returns false if the game has
   * already started.
   */
  startIntroPhase() {
    if (this.phase !== PHASES.LOBBY) return false;
    this.startedAt = Date.now();
    this.enterPhase(PHASES.INTRO);
    console.log(`[game ${this.roomCode}] started (gameId ${this.gameId})`);
    return true;
  }

  /**
   * INTRO -> ROLE_ASSIGN: deal roles and emit one private 'role:assigned'
   * event per node ({ node, role }) for socket.js to deliver to that phone only.
   */
  startRoleAssignmentPhase() {
    const assignment = this.assignRoles(this.data.roles);
    for (const [node, role] of Object.entries(assignment)) {
      this.emit('role:assigned', { node, role });
    }
    this.enterPhase(PHASES.ROLE_ASSIGN);
  }

  /** ROLE_ASSIGN -> CHAMBER: reveal the region map on the projector. */
  startCouncilChamberPhase() {
    this.enterPhase(PHASES.CHAMBER, { region: REGION });
  }

  /**
   * Initialise per-cycle state. Cycle 1 also resets the society: GDW = 25.
   */
  startCycle(cycleNumber) {
    this.cycle = cycleNumber;
    this.votes = {};
    this.crisis = null;
    this.lastResolution = null;
    if (cycleNumber === 1) {
      this.gdw = STARTING_GDW;
      this.gdwHistory = [STARTING_GDW];
      this.volatility = 1.0;
      this.choices = {};
      this.worldKey = null;
    }
    console.log(`[game ${this.roomCode}] cycle ${cycleNumber} begins (GDW ${this.gdw})`);
  }

  /** Crisis fields safe to show everyone (no effects, roles or intel). */
  publicCrisis() {
    if (!this.crisis) return null;
    const { id, title, subtitle, incident, loomIntro } = this.crisis;
    return { id, title, subtitle, incident, loomIntro };
  }

  /** Milliseconds left on the current phase timer (0 when none). */
  timeRemainingMs() {
    return this.endsAt ? Math.max(0, this.endsAt - Date.now()) : 0;
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
  selectCrisis,
  normalizeCrisis,
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
  MAX_PLAYERS,
  PHASES,
  TOTAL_CYCLES,
  STARTING_GDW,
  REGION,
  PHASE_STARTERS,
  DEFAULT_PHASE_SECONDS,
  buildPhaseDurations
};
