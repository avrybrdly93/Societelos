'use strict';

// Societelos — Stream 1 authoritative game state machine.
// The server is the only source of truth: this module owns game state and
// phase timers. socket.js translates client events into calls on it.

const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const sim = require('./sim');
const loom = require('./loom');
const { bordaCount, rankBorda, selectEnacted, packageEffects, BORDA_POINTS, FINALE_WEIGHTS, FINALE_ROLE_POINTS } = require('./finale');

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
    citizens: readJson(path.join(dataDir, 'citizens.json'), []),
    sim: readJson(path.join(dataDir, 'sim.json'), null)
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
const ASSEMBLY_VOLATILITY = 1.5;
const FINALE_MAX_CHARS = 140; // finale write-in length limit
// Submitted for a node that is idle or disconnected when FINALE_WRITE ends.
const PLACEHOLDER_POLICY = 'Continue current policy unchanged while the council reviews its options.';
const ZERO_EFFECTS = Object.freeze({ purpose: 0, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 });
const FINALE_RESUBMIT_MS = 25000; // one resubmit window for "revise" write-ins
const DEFAULT_FINALE_POLICY = 'Keep the current policies in place and review them again next year.';
// Upper bound on narration time (loom.js aborts Gemini after 8 s) added to the
// RESOLUTION safety timer.
const LOOM_BUDGET_MS = 10000;

/** Clamp GDW to [0, 100] and round to one decimal place (e.g. 25.0%). */
function roundGdw(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
}
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
  INTEL: 'startIntelDropPhase',
  DEBATE: 'startDebatePhase',
  VOTE: 'startBlindVotePhase',
  RESOLUTION: 'startResolutionPhase',
  WORLD_REVEAL: 'startWorldRevealPhase',
  FINALE_WRITE: 'startFinaleWritePhase',
  FINALE_MOD: 'startFinaleModPhase',
  FINALE_DEBATE: 'startFinaleDebatePhase',
  FINALE_RANK: 'startFinaleRankPhase',
  FINALE_ENACT: 'startFinaleEnactPhase'
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

// Debug: FAST_TIMERS=true shrinks every phase to this many seconds.
const FAST_TIMER_SECONDS = 3;

/**
 * Build the phase duration dictionary in milliseconds.
 * `overrides` (seconds) win over env, env wins over defaults.
 * FAST_TIMERS=true sets every phase to 3 s for rapid automated testing.
 */
function buildPhaseDurations(env = process.env, overrides = {}) {
  const seconds = { ...DEFAULT_PHASE_SECONDS };
  const debate = Number(env.DEBATE_SECONDS);
  if (Number.isFinite(debate) && debate > 0) seconds.DEBATE = debate;
  if (String(env.FAST_TIMERS).toLowerCase() === 'true') {
    // FAST_TIMER_SECONDS (optional) shrinks further, e.g. 0.01 in automated tests.
    const custom = Number(env.FAST_TIMER_SECONDS);
    const fast = Number.isFinite(custom) && custom > 0 ? custom : FAST_TIMER_SECONDS;
    for (const phase of Object.keys(seconds)) seconds[phase] = fast;
  }
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
    rolesByWorld: raw.rolesByWorld || null,
    worldNotes: raw.worldNotes || null,
    volatility: typeof raw.volatility === 'number' ? raw.volatility : null,
    loomLine: raw.loomLine || null,
    loomLines: raw.loomLines || null,
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
    debateHooks: Array.isArray(raw.debateHooks) ? raw.debateHooks.filter((h) => typeof h === 'string' && h.trim()) : [],
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
  const list = Array.isArray(crises) ? crises : crises && Array.isArray(crises.crises) ? crises.crises : null;
  if (list) {
    raw = list.find((c) => c.world === world && c.cycle === cycle) || null;
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
// Broadcast sanitizer: phase payloads go to every phone, so they must never
// carry secret role mappings, effect vectors, intel or connection secrets.
// ---------------------------------------------------------------------------

const SECRET_KEYS = new Set([
  'effects', 'effectsByWorld', 'rolesByWorld', 'roles', 'role', 'roleAssignment', 'intel', 'intelDrops',
  'token', 'socketId', 'name', 'reactions', 'volatility',
  // Override secrecy: never reveal per-node votes or who spent an Override.
  'votes', 'override', 'overridesUsed',
  // Finale anonymity: authors and moderation stay server-side until the end.
  'authors', 'author', 'node', 'moderation', 'submissions', 'ballots', 'ranks'
]);

/** Deep copy of `value` with every SECRET_KEYS field removed. */
function sanitizeForBroadcast(value, allow = []) {
  const allowed = new Set(allow);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (ArrayBuffer.isView(v)) return Array.from(v); // Float64Array etc. -> plain JSON array
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, inner] of Object.entries(v)) {
      if (SECRET_KEYS.has(k) && !allowed.has(k)) continue;
      out[k] = walk(inner);
    }
    return out;
  };
  return walk(value);
}

// ---------------------------------------------------------------------------
// Stream 4 interfaces. The real simulate() from server/sim drives every
// resolution; the Loom stub below remains only as a last-resort fallback.
// ---------------------------------------------------------------------------

/** The simulation entry point used by the engine (server/sim/index.js). */
function resolveSimulate() {
  return sim.simulate;
}

/** Fresh cohort state from data/sim.json, or null if the config is missing. */
function createSimState(simConfig) {
  if (!simConfig) return null;
  try {
    return sim.createInitialState(simConfig);
  } catch (err) {
    console.error(`[gameEngine] could not build sim state: ${err.message}`);
    return null;
  }
}

/**
 * Last-resort canned narration, used only if server/loom.js itself throws
 * (it already falls back to authored lines when Gemini is unavailable).
 * Both are async to match the real Gemini-backed interface.
 */
const loomStub = {
  async narrate(context = {}) {
    const delta = (context.simSummary || context.summary)?.realizedDelta ?? 0;
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

/** The Loom module used by the engine (server/loom.js, Gemini with offline fallback). */
function resolveLoom() {
  return loom;
}

const CATALYST_SWING = 10;

/**
 * Catalyst rule: a cycle "moves the needle" when realized GDW swings by at
 * least 10 points either way, unless the swing shut the Loom down (GDW 0).
 * The swing is compared at one decimal place, so -10.0 counts and -9.9 does not.
 */
function catalystScores(previousGdw, realizedGdw) {
  const swing = Math.round(Math.abs(realizedGdw - previousGdw) * 10) / 10;
  return swing >= CATALYST_SWING && realizedGdw > 0;
}

/** World key from the first two votes: 'AA' | 'AB' | 'BA' | 'BB' (null if incomplete). */
function computeWorldKey(vote1, vote2) {
  const ok = (v) => v === 'A' || v === 'B';
  return ok(vote1) && ok(vote2) ? vote1 + vote2 : null;
}

const TIE_EPSILON = 1e-9;

/** Final-month forecast median GDW of a simulate() result (NaN if missing). */
function forecastMedianEnd(simResult) {
  const median = simResult && simResult.forecast && simResult.forecast.median;
  return Array.isArray(median) && median.length ? median[median.length - 1] : NaN;
}

/**
 * The Loom's tie-breaker: on a weighted A/B tie it picks the option whose
 * forecast median GDW ends higher. It is protecting itself.
 * @returns {'A' | 'B'}
 */
function breakTie(simA, simB) {
  const a = forecastMedianEnd(simA);
  const b = forecastMedianEnd(simB);
  // Deterministic fallback: identical medians (compared at 1e-9, so float
  // noise can't flip it) or a missing forecast default to Option A.
  if (!Number.isFinite(b)) return 'A';
  if (!Number.isFinite(a)) return 'B';
  return b - a > TIE_EPSILON ? 'B' : 'A';
}

/**
 * State for one game room (one projector + 5 phones).
 * Emits events ('phase', ...) that socket.js relays to clients.
 */
class GameState extends EventEmitter {
  constructor({ roomCode = null, phaseSeconds = {}, data = null, showForecastBeforeVote = null } = {}) {
    super();
    this.roomCode = roomCode;
    // Optional: show both options' forecast fans during DEBATE (SHOW_FORECAST_BEFORE_VOTE=true).
    this.showForecastBeforeVote = typeof showForecastBeforeVote === 'boolean'
      ? showForecastBeforeVote
      : String(process.env.SHOW_FORECAST_BEFORE_VOTE).toLowerCase() === 'true';
    this.simCache = {}; // option key -> simulate() result for the current cycle
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
    this.gdwHistory = []; // monthly realized GDW: [start, month 1, ..., month 12 of cycle 1, month 1 of cycle 2, ...]
    this.volatility = 1.0;
    this.worldKey = null;
    this.ending = null; // 'shutdown' once GDW reaches 0
    this.voteHistory = {}; // cycle number -> winning binary option ('A' | 'B')

    // Current cycle.
    this.crisis = null;
    this.votes = {}; // node id -> { choice, override }
    this.lastResolution = null;

    // Scoring.
    this.scores = {};
    this.scoreLedger = []; // per cycle: { cycle, winner, role: { node: 1 }, catalyst: { node: 1 } }
    this.overridesUsed = {}; // node id -> true once its single Override is spent (whole game)
  }

  /**
   * Authoritative server timer. Sets `endsAt = Date.now() + durationMs` (the
   * timestamp clients count down to) and calls `onExpire` when it passes.
   * Returns endsAt, or null when the phase has no duration.
   */
  startPhaseTimer(durationMs, onExpire) {
    this.clearPhaseTimer();
    if (this.stopped) return null; // a closed room never restarts its clock
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
   * Stop the game for good (room closed): clears the timer and makes any
   * late async work (moderation, narration) unable to restart one.
   */
  stop() {
    this.stopped = true;
    this.clearPhaseTimer();
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
        if (this.ending === 'shutdown' || this.gdw <= 0 || this.cycle >= TOTAL_CYCLES) return P.END;
        return this.cycle === 2 ? P.WORLD_REVEAL : P.INCIDENT;
      case P.WORLD_REVEAL: return P.INCIDENT;
      case P.FINALE_WRITE: return P.FINALE_MOD;
      case P.FINALE_MOD:
        // Moderation never came back before the FINALE_MOD timer: authored A/B.
        if (this.finale && !this.finale.moderationDone && !this.finaleFallback) {
          this.finaleFallback = true;
          this.finale.closed = true;
        }
        // The resubmit window ran out: settle whatever is still in revision.
        if (this.finale && this.finale.moderationDone && !this.finale.closed) this.finishFinaleModeration({ advance: false });
        return this.finaleFallback ? P.DEBATE : P.FINALE_DEBATE;
      case P.FINALE_DEBATE: return P.FINALE_RANK;
      case P.FINALE_RANK: return P.FINALE_ENACT;
      case P.FINALE_ENACT: return P.END;
      default: return P.END;
    }
  }

  /**
   * True when the current cycle is the write-and-rank finale: cycle 5 with a
   * crisis in mode "writein" that has not fallen back to its authored A/B.
   */
  isFinaleWriteIn() {
    return this.cycle === TOTAL_CYCLES && !this.finaleFallback && !!this.crisis && this.crisis.mode === 'writein';
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
    if (process.env.LOG_PHASES === 'true' || from === PHASES.RESOLUTION || to === PHASES.END) {
      console.log(`[game ${this.roomCode}] ${from} -> ${to} (cycle ${this.cycle})`);
    }
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
  enterPhase(phase, extra = {}, durationMs = this.durations[phase]) {
    this.phase = phase;
    const endsAt = this.startPhaseTimer(durationMs, () => this.advancePhase());
    // Option names are public, so 'name' is allowed; everything secret is stripped.
    const payload = sanitizeForBroadcast({ cycle: this.cycle, phase, endsAt, crisis: this.publicCrisis(), ...extra }, ['name']);
    this.emit('phase', payload);
    return endsAt;
  }

  /**
   * INCIDENT: pick this cycle's crisis (Fixed Crisis 1 in cycle 1) and show
   * the incident on the projector.
   */
  startIncidentPhase() {
    this.crisis = selectCrisis(this.data.crises, this.cycle, this.worldKey, this.data.roles);
    if (!this.crisis) console.error(`[game ${this.roomCode}] no crisis for cycle ${this.cycle}`);
    if (this.cycle === TOTAL_CYCLES) this.initFinale();
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
   * Cycle 5 set-up. A "writein" crisis starts the write-and-rank finale
   * (INCIDENT shows no options, then FINALE_WRITE); any other crisis, or a
   * missing one, plays as a normal binary vote on its authored A/B.
   */
  initFinale() {
    this.finaleFallback = !(this.crisis && this.crisis.mode === 'writein');
    this.finale = {
      submissions: {}, // node -> raw text (trimmed)
      moderation: {}, // node -> loom.moderate result
      revise: {}, // node -> 'pending' | 'resubmitted' | 'done'
      policies: [], // [{ id, node, text, roles, effects }] after moderation
      authors: {}, // policyId -> node (secret until game:end)
      ballots: {}, // node -> [policyId x4]
      ranks: {}, // node -> [policyId x4]
      tally: null,
      enacted: null
    };
    console.log(`[game ${this.roomCode}] finale: ${this.finaleFallback ? 'binary A/B' : 'write-and-rank'} (${this.crisis ? this.crisis.id : 'no crisis'})`);
  }

  /**
   * FINALE_WRITE (45 s): after the 15 s finale INCIDENT (no options shown),
   * every phone writes one policy of up to 140 characters.
   */
  startFinaleWritePhase() {
    if (!this.finale) this.initFinale();
    this.finale.writingOpen = true;
    this.enterPhase(PHASES.FINALE_WRITE, { finale: { maxLength: FINALE_MAX_CHARS } });
  }

  /**
   * Record a phone's finale write-in during FINALE_WRITE (one per node; a
   * later submit before the timer replaces it). Returns { ok } or { ok: false, reason }.
   */
  submitPolicy(node, text) {
    if (this.phase !== PHASES.FINALE_WRITE || !this.finale || !this.finale.writingOpen) return { ok: false, reason: 'WRITING_CLOSED' };
    if (!this.players[node]) return { ok: false, reason: 'UNKNOWN_NODE' };
    // Server-side hygiene: collapse whitespace, trim, cap at 140 characters.
    const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, FINALE_MAX_CHARS).trim();
    if (!clean) return { ok: false, reason: 'EMPTY' };
    this.finale.submissions[node] = clean;
    // All five in: move on to FINALE_MOD now rather than waiting out the 45 s.
    const seated = Object.keys(this.players);
    if (seated.length && seated.every((n) => this.finale.submissions[n])) {
      setImmediate(() => { if (this.phase === PHASES.FINALE_WRITE) this.advancePhase(); });
    }
    return { ok: true, text: clean };
  }

  /**
   * Close FINALE_WRITE: every seated node without a write-in (idle or
   * disconnected) gets the neutral default policy. Returns the defaulted nodes.
   */
  closeFinaleWriting() {
    if (!this.finale) return [];
    this.finale.writingOpen = false;
    const defaulted = [];
    for (const node of Object.keys(this.players)) {
      if (!this.finale.submissions[node]) {
        this.finale.submissions[node] = DEFAULT_FINALE_POLICY;
        defaulted.push(node);
      }
    }
    this.finale.defaulted = defaulted;
    return defaulted;
  }

  /** FINALE_MOD: writing closes (defaults filled) while the Loom moderates. */
  startFinaleModPhase() {
    this.closeFinaleWriting();
    this.enterPhase(PHASES.FINALE_MOD);
    return this.runFinaleModeration();
  }

  /**
   * One batch loom.moderate call for all five write-ins. Sends only node ids
   * and text (player names are passed for redaction, never transmitted).
   * Resolves with the results (also stored in finale.moderation).
   */
  runFinaleModeration() {
    const finale = this.finale;
    const submissions = Object.entries(finale.submissions).map(([node, text]) => ({ node, text }));
    const playerNames = Object.values(this.players).map((p) => p.name);
    const started = Date.now();
    return Promise.resolve()
      .then(() => resolveLoom().moderate(submissions, this.crisis || {}, { playerNames }))
      .catch((err) => {
        console.error(`[game ${this.roomCode}] moderation failed: ${err.message}`);
        return submissions.map((sub) => ({ node: sub.node, status: 'ok', cleaned: sub.text, feedback: '', roles: [], effects: {}, fallback: true }));
      })
      .then((results) => {
        finale.moderationMs = Date.now() - started;
        for (const r of results || []) if (r && r.node) finale.moderation[r.node] = r;
        finale.moderationDone = true;
        // Trace: latency and outcome counts only (never the texts or authors).
        const counts = { ok: 0, revise: 0, reject: 0, fallback: 0 };
        for (const r of results || []) {
          if (r && r.fallback) counts.fallback++;
          else if (r && counts[r.status] !== undefined) counts[r.status]++;
        }
        console.log(`[game ${this.roomCode}] finale moderation ${finale.moderationMs} ms: ${counts.ok} ok, ${counts.revise} revise, ${counts.reject} reject, ${counts.fallback} fallback`);
        this.onFinaleModeration(results || []);
        return results;
      });
  }

  /**
   * Act on the batch moderation. If Gemini was unavailable (every result is a
   * fallback: no key, error or the 8 s timeout), cycle 5 switches to the
   * world's authored A/B finale and plays a normal DEBATE -> VOTE.
   */
  onFinaleModeration(results) {
    if (this.phase !== PHASES.FINALE_MOD || this.finale.closed) return;
    const failed = !results.length || results.every((r) => r && r.fallback);
    if (failed) {
      this.switchFinaleToBinary('moderation unavailable');
      return;
    }
    const revise = results.filter((r) => r.status === 'revise');
    if (!revise.length) {
      this.finishFinaleModeration();
      return;
    }
    // "revise": tell only the author why (finale:feedback) and give everyone
    // in revision one 25 s resubmit window, still inside FINALE_MOD.
    for (const r of revise) {
      this.finale.revise[r.node] = 'pending';
      this.emit('finale:feedback', { node: r.node, status: 'revise', feedback: String(r.feedback || 'Please rephrase your policy as one clear, school-appropriate sentence.') });
    }
    this.enterPhase(PHASES.FINALE_MOD, { resubmit: true, revising: revise.length }, FINALE_RESUBMIT_MS);
  }

  /**
   * Moderation settled: turn each node's moderated write-in into a policy
   * { id, node, text, roles, effects } and move straight on to FINALE_DEBATE.
   */
  finishFinaleModeration({ advance = true } = {}) {
    const finale = this.finale;
    if (finale.closed) return;
    finale.closed = true;
    // Anonymous ids: POLICY-1..5 follow a shuffle seeded by the game id, so
    // projector order never mirrors NODE-01..NODE-05.
    const order = seededShuffle(Object.keys(this.players), hashSeed(this.gameId, 'finale-policies'));
    finale.policies = order.map((node, i) => {
      const m = finale.moderation[node] || {};
      // "reject", a second "revise", or a resubmit that never came / timed
      // out: a safe, bland placeholder so nothing unmoderated is shown.
      if (m.status !== 'ok') {
        return { id: `POLICY-${i + 1}`, node, text: PLACEHOLDER_POLICY, roles: [], effects: { ...ZERO_EFFECTS }, placeholder: true };
      }
      return {
        id: `POLICY-${i + 1}`,
        node,
        text: String(m.cleaned || finale.submissions[node] || DEFAULT_FINALE_POLICY).slice(0, FINALE_MAX_CHARS),
        roles: Array.isArray(m.roles) ? m.roles : [],
        effects: m.effects || {}
      };
    });
    // Secret policyId -> author map, revealed only on the end screen.
    finale.authors = Object.fromEntries(finale.policies.map((p) => [p.id, p.node]));
    if (advance && this.phase === PHASES.FINALE_MOD) this.advancePhase();
  }

  /** The finale policies everyone may see: [{ id, text }] (no tags, effects or authors). */
  publicPolicies() {
    return ((this.finale && this.finale.policies) || []).map((p) => ({ id: p.id, text: p.text }));
  }

  /** FINALE_DEBATE (60 s): the five anonymised policies go up on the projector. */
  startFinaleDebatePhase() {
    this.enterPhase(PHASES.FINALE_DEBATE, { policies: this.publicPolicies() });
  }

  /**
   * Personal ballots: each node ranks only the four policies it did not
   * write. Returns { node: [policyId x4] } in projector order.
   */
  buildBallots() {
    const ballots = {};
    for (const node of Object.keys(this.players)) {
      ballots[node] = this.finale.policies.filter((p) => p.node !== node).map((p) => p.id);
    }
    this.finale.ballots = ballots;
    return ballots;
  }

  /** FINALE_RANK (30 s): deal each phone its four-policy ballot privately. */
  startFinaleRankPhase() {
    const ballots = this.buildBallots();
    this.finale.rankingOpen = true;
    this.enterPhase(PHASES.FINALE_RANK);
    const texts = Object.fromEntries(this.finale.policies.map((p) => [p.id, p.text]));
    for (const [node, ids] of Object.entries(ballots)) {
      this.emit('finale:ballot', { node, policies: ids.map((id) => ({ id, text: texts[id] })) });
    }
  }

  /** Record a node's ranking { order: [id x4] } during FINALE_RANK. */
  rankPolicies(node, order) {
    if (this.phase !== PHASES.FINALE_RANK || !this.finale || !this.finale.rankingOpen) return { ok: false, reason: 'RANKING_CLOSED' };
    if (!this.players[node]) return { ok: false, reason: 'UNKNOWN_NODE' };
    // Exactly the 4 policies on this node's ballot, each once: never its own,
    // never an unknown id, whatever a spoofed packet claims.
    const ballot = this.finale.ballots[node] || [];
    if (!Array.isArray(order) || order.length !== 4) return { ok: false, reason: 'BAD_ORDER' };
    if (new Set(order).size !== 4) return { ok: false, reason: 'DUPLICATE_POLICY' };
    if (order.some((id) => this.finale.authors[id] === node)) return { ok: false, reason: 'OWN_POLICY' };
    if (!order.every((id) => ballot.includes(id))) return { ok: false, reason: 'UNKNOWN_POLICY' };
    this.finale.ranks[node] = order.slice();
    // All five ranked: enact now rather than waiting out the 30 s.
    const seated = Object.keys(this.players);
    if (seated.every((n) => this.finale.ranks[n])) {
      setImmediate(() => { if (this.phase === PHASES.FINALE_RANK) this.advancePhase(); });
    }
    return { ok: true };
  }

  /**
   * Close FINALE_RANK: a node that never ranked (disconnected or idle) gets a
   * deterministic default order, its ballot shuffled by a seed from the game
   * id and node (no bias toward POLICY-1). Returns the defaulted nodes.
   */
  closeRanking() {
    const finale = this.finale;
    finale.rankingOpen = false;
    const defaulted = [];
    for (const node of Object.keys(this.players)) {
      if (finale.ranks[node]) continue;
      finale.ranks[node] = seededShuffle(finale.ballots[node] || [], hashSeed(this.gameId, 'finale-rank', node));
      defaulted.push(node);
    }
    finale.rankDefaulted = defaulted;
    return defaulted;
  }

  /** Forecast median end GDW of one finale policy on its own (Borda tie-breaker). */
  finaleMedianOf(policyId) {
    const policy = this.finale.policies.find((p) => p.id === policyId);
    const r = resolveSimulate()({ gdw: this.gdw, simState: this.simState }, (policy && policy.effects) || {}, {
      runs: 200, seed: hashSeed(this.gameId, this.cycle, policyId), volatility: this.volatility
    });
    return forecastMedianEnd(r);
  }

  /**
   * FINALE_ENACT (20 s): rankings close, the Borda tally picks the top three,
   * and their 50/25/25 package is simulated as cycle 5's realized run.
   */
  startFinaleEnactPhase() {
    this.closeRanking();
    const finale = this.finale;
    const byId = Object.fromEntries(finale.policies.map((p) => [p.id, p]));
    finale.tally = bordaCount(finale.ranks, finale.policies.map((p) => p.id));
    finale.rows = rankBorda(finale.tally, (id) => this.finaleMedianOf(id));
    finale.enacted = selectEnacted(finale.rows);
    console.log(`[game ${this.roomCode}] finale Borda: ${finale.rows.map((r) => `${r.id} ${r.points} [${r.places.join('/')}]`).join(', ')}${finale.rankDefaulted.length ? `; ${finale.rankDefaulted.length} default ballot(s)` : ''}`);
    finale.packageEffects = packageEffects(finale.enacted, (id) => byId[id] && byId[id].effects);

    const previousGdw = this.gdw;
    const stateBefore = this.simState;
    const simResult = resolveSimulate()({ gdw: this.gdw, simState: this.simState }, finale.packageEffects, {
      runs: 500, seed: hashSeed(this.gameId, this.cycle), volatility: this.volatility
    });
    this.applySimResult(simResult);
    this.voteHistory[this.cycle] = 'package';
    if (this.gdw <= 0) this.ending = 'shutdown';
    finale.previousGdw = previousGdw;
    finale.simResult = simResult;
    finale.awards = this.scoreFinale(finale.enacted, previousGdw, this.gdw);

    const enactMs = this.durations.FINALE_ENACT;
    this.enterPhase(PHASES.FINALE_ENACT, {}, enactMs + LOOM_BUDGET_MS);
    console.log(`[game ${this.roomCode}] finale enacted ${finale.enacted.map((e) => `${e.id} ${e.weight * 100}%`).join(', ')}; GDW ${previousGdw} -> ${this.gdw}`);
    // The Loom narrates the whole package: the three enacted policies and their weights.
    const option = {
      name: 'The Council Package',
      text: finale.enacted.map((e) => `${Math.round(e.weight * 100)}%: ${byId[e.id].text}`).join(' | '),
      summary: 'Three council-written policies enacted together at 50/25/25.'
    };
    // Public Borda tally (best first) and the enacted top three; no authors.
    const tally = finale.rows.map((r) => ({ id: r.id, points: r.points, places: r.places.slice() }));
    const enacted = finale.enacted.map((e) => ({ id: e.id, text: byId[e.id].text, place: e.place, weight: e.weight, points: e.points }));
    const result = { cycle: this.cycle, finale: true, policy: option.name, tally, enacted, previousGdw, gdwDelta: Math.round((this.gdw - previousGdw) * 10) / 10 };
    const scoreUpdates = Object.keys(this.players).map((node) => {
      const role = finale.awards.role[node] || 0;
      const author = finale.awards.author[node] || 0;
      const catalyst = finale.awards.catalyst[node] || 0;
      return { node, cycle: this.cycle, gained: role + author + catalyst, role, author, catalyst, total: this.scores[node] || 0 };
    });
    finale.narrated = this.narrateAndBroadcast({ phase: PHASES.FINALE_ENACT, durationMs: enactMs, result, option, simResult, stateBefore, scoreUpdates });
    return finale.narrated;
  }

  /**
   * Finale role scoring: roles tagged on the 1st-place policy score +2, on
   * the 2nd and 3rd +1 each, cumulatively (a role on several enacted
   * policies collects each award). Returns { node: points } for nodes scored.
   */
  awardFinaleRolePoints(enacted) {
    const awards = {};
    const byId = Object.fromEntries((this.finale.policies || []).map((p) => [p.id, p]));
    for (const { id, place } of enacted) {
      const points = FINALE_ROLE_POINTS[place] || 0;
      const tags = new Set((byId[id] && byId[id].roles) || []);
      for (const [node, role] of Object.entries(this.roleAssignment || {})) {
        if (role && tags.has(role.key)) awards[node] = (awards[node] || 0) + points;
      }
    }
    for (const [node, pts] of Object.entries(awards)) this.scores[node] = (this.scores[node] || 0) + pts;
    return awards;
  }

  /** Finale author bonus: +1 to whoever wrote the 1st-place policy. Returns { node: 1 }. */
  awardAuthorBonus(enacted) {
    const first = enacted.find((e) => e.place === 'first');
    const node = first && this.finaleAuthor(first.id);
    if (!node || !this.players[node]) return {};
    this.scores[node] = (this.scores[node] || 0) + 1;
    return { [node]: 1 };
  }

  /**
   * All finale scoring for the enacted package: role points (+2/+1/+1),
   * the author bonus, and the Catalyst's +1 if the package moved realized
   * GDW by 10 or more without shutting the Loom down. Records the ledger
   * entry and returns { role, author, catalyst } award maps.
   */
  scoreFinale(enacted, previousGdw, realizedGdw) {
    const role = this.awardFinaleRolePoints(enacted);
    const author = this.awardAuthorBonus(enacted);
    const catalyst = this.awardCatalystPoints(previousGdw, realizedGdw);
    this.scoreLedger.push({ cycle: this.cycle, winner: enacted.map((e) => e.id).join(','), role, author, catalyst });
    return { role, author, catalyst };
  }

  /** Nodes that have ranked (never their order). */
  rankedNodes() {
    return this.finale ? Object.keys(this.finale.ranks) : [];
  }

  /** Author of a finale policy (server-side only; null if unknown). */
  finaleAuthor(policyId) {
    return (this.finale && this.finale.authors[policyId]) || null;
  }

  /** Fall back to the authored A/B finale: FINALE_MOD -> DEBATE -> VOTE -> RESOLUTION -> END. */
  switchFinaleToBinary(reason) {
    if (this.finaleFallback) return;
    this.finaleFallback = true;
    this.finale.closed = true;
    console.log(`[game ${this.roomCode}] finale falls back to authored A/B (${reason})`);
    if (this.phase === PHASES.FINALE_MOD) this.advancePhase();
  }

  /**
   * The single resubmission allowed to a node asked to revise, during the
   * FINALE_MOD resubmit window. Returns { ok, text } or { ok: false, reason }.
   */
  resubmitPolicy(node, text) {
    const finale = this.finale;
    if (this.phase !== PHASES.FINALE_MOD || !finale || finale.closed) return { ok: false, reason: 'NOT_REVISING' };
    if (finale.revise[node] !== 'pending') return { ok: false, reason: finale.revise[node] ? 'ALREADY_RESUBMITTED' : 'NOT_REVISING' };
    const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, FINALE_MAX_CHARS).trim();
    if (!clean) return { ok: false, reason: 'EMPTY' };
    finale.revise[node] = 'resubmitted';
    finale.submissions[node] = clean;
    finale.pending = this.moderateResubmission(node, clean);
    return { ok: true, text: clean };
  }

  /**
   * loom.moderateOne on a resubmission; when every revision is settled the
   * finale moves on to FINALE_DEBATE without waiting out the window.
   */
  moderateResubmission(node, text) {
    const finale = this.finale;
    const loom = resolveLoom();
    const call = typeof loom.moderateOne === 'function'
      ? () => loom.moderateOne({ node, text }, this.crisis || {}, { playerNames: Object.values(this.players).map((p) => p.name) })
      : () => Promise.resolve({ node, status: 'reject', fallback: true });
    return Promise.resolve()
      .then(call)
      .catch(() => ({ node, status: 'reject', fallback: true }))
      .then((result) => {
        if (finale.closed || this.finale !== finale) return result;
        finale.moderation[node] = { ...result, node };
        finale.revise[node] = 'done';
        if (Object.values(finale.revise).every((v) => v === 'done')) this.finishFinaleModeration();
        return result;
      });
  }

  /** Nodes that have submitted a finale policy (never the text). */
  submittedNodes() {
    return this.finale ? Object.keys(this.finale.submissions) : [];
  }

  /** Public view of policy options A and B (no effect vectors or role tags). */
  publicOptions() {
    const opts = (this.crisis && this.crisis.options) || {};
    const view = {};
    for (const key of ['A', 'B']) {
      const o = opts[key];
      if (o) view[key] = { key, name: o.name, text: o.text, summary: o.summary };
    }
    return view;
  }

  /** DEBATE: broadcast options A and B with the countdown's endsAt. */
  startDebatePhase() {
    const extra = { options: this.publicOptions() };
    if (this.showForecastBeforeVote && this.crisis) extra.forecasts = this.publicForecasts();
    this.enterPhase(PHASES.DEBATE, extra);
  }

  /** VOTE: open blind vote collection for the vote timer (15 s). */
  startBlindVotePhase() {
    this.votes = {};
    this.votingOpen = true;
    this.enterPhase(PHASES.VOTE);
    // Private per-phone Override status (never broadcast: it would reveal who spent one).
    for (const node of Object.keys(this.players)) {
      this.emit('override:status', { node, overrideAvailable: this.overrideAvailable(node) });
    }
  }

  /**
   * Record a blind vote while voting is open. One vote per node per cycle.
   * Returns { ok: true } or { ok: false, reason }.
   */
  castVote(node, choice, override = false) {
    if (!this.votingOpen || this.phase !== PHASES.VOTE) return { ok: false, reason: 'VOTING_CLOSED' };
    if (!this.players[node]) return { ok: false, reason: 'UNKNOWN_NODE' };
    if (choice !== 'A' && choice !== 'B') return { ok: false, reason: 'BAD_CHOICE' };
    if (this.votes[node]) return { ok: false, reason: 'ALREADY_VOTED' };
    // Overrides don't apply in the finale (cycle 5, including its A/B fallback):
    // the flag is ignored and the Override stays unspent.
    const useOverride = override === true && this.cycle < TOTAL_CYCLES;
    // Reject a second Override: the vote is not recorded, so the phone may recast.
    if (useOverride && this.overridesUsed[node]) return { ok: false, reason: 'OVERRIDE_SPENT' };
    this.votes[node] = { choice, override: useOverride };
    // One Override per player per game: spent the moment it is cast.
    if (useOverride) this.overridesUsed[node] = true;
    return { ok: true };
  }

  /** True while `node` still holds its one Override for this game. */
  overrideAvailable(node) {
    return !!this.players[node] && !this.overridesUsed[node];
  }

  /** True once every seated player has voted this cycle. */
  allVotesIn() {
    const seated = Object.keys(this.players);
    return seated.length > 0 && seated.every((node) => this.votes[node]);
  }

  /**
   * Count the blind votes: a normal vote is worth 1, an Override 2.
   * `winner` is provisional on a tie; startResolutionPhase applies breakTie.
   */
  tallyVotes() {
    const totals = { A: 0, B: 0 };
    for (const { choice, override } of Object.values(this.votes)) {
      totals[choice] += override ? 2 : 1;
    }
    const winner = totals.B > totals.A ? 'B' : 'A';
    // A seated node with no vote when the timer expires (e.g. a disconnected
    // phone) abstains: it adds nothing to either side.
    const abstained = Object.keys(this.players).filter((node) => !this.votes[node]).length;
    return { totals, winner, tie: totals.A === totals.B, abstained };
  }

  /** Option `key` of the current crisis, or an empty placeholder. */
  optionFor(key) {
    return (this.crisis && this.crisis.options && this.crisis.options[key]) || { key, name: `Policy ${key}`, effects: {}, roles: [] };
  }

  /**
   * Look up a per-world variant (Fixed Crisis 2B): keyed by Cycle 1's winner,
   * as 'A' / 'B' or '1A' / '1B'. Returns undefined when there is none.
   */
  byCycle1World(table) {
    if (!table) return undefined;
    const first = this.voteHistory[1] || 'A';
    return table[first] || table[`1${first}`];
  }

  /**
   * Effect vector option `key` applies in this game. Fixed Crisis 2B depends
   * on Cycle 1: after 1A the Loom holds power (assimilator effects), after 1B
   * the Owners' Board does (lotus effects).
   */
  effectsFor(key) {
    const option = this.optionFor(key);
    return this.byCycle1World(option.effectsByWorld) || option.effects || {};
  }

  /** Role tags scored by option `key` (world-dependent for Crisis 2B). */
  rolesFor(key) {
    const option = this.optionFor(key);
    const roles = this.byCycle1World(option.rolesByWorld) || option.roles;
    return Array.isArray(roles) ? roles : [];
  }

  /**
   * Run the cycle's simulation (500 forecasts + realized) for option `key`.
   * Results are cached per cycle: the inputs (state, effects, seed) are fixed
   * until resolution, so a DEBATE pre-forecast is reused, not recomputed.
   */
  runSimulation(key) {
    if (this.simCache[key]) return this.simCache[key];
    const simulate = resolveSimulate();
    return (this.simCache[key] = simulate({ gdw: this.gdw, simState: this.simState }, this.effectsFor(key), {
      runs: 500,
      seed: hashSeed(this.gameId, this.cycle),
      volatility: this.volatility
    }));
  }

  /** Public forecast fans for options A and B (no effect vectors). */
  publicForecasts() {
    const view = {};
    for (const key of ['A', 'B']) {
      const { median, p5, p95, pCollapse, pUnrest } = this.runSimulation(key).forecast;
      view[key] = { median, p5, p95, pCollapse, pUnrest };
    }
    return view;
  }

  /**
   * Carry a cycle's realized run into the game: next sim state, GDW (one
   * decimal) and the monthly trajectory appended to gdwHistory (months 1-12;
   * month 0 is the previous cycle's last entry).
   */
  applySimResult(simResult) {
    if (simResult.finalState) this.simState = simResult.finalState;
    this.gdw = roundGdw(simResult.realized.finalGdw);
    // (realized.gdw may be a Float64Array, so copy it into a plain array.)
    const trajectory = simResult.realized.gdw;
    const monthly = trajectory && typeof trajectory.length === 'number' ? Array.from(trajectory).slice(1).map(roundGdw) : [];
    if (monthly.length) monthly[monthly.length - 1] = this.gdw;
    this.gdwHistory.push(...(monthly.length ? monthly : [this.gdw]));
  }

  /**
   * Role scoring (cycles 1-4): +1 to every node whose secret role is tagged
   * on the winning option. Returns { node: points } for the nodes scored.
   */
  awardRolePoints(winner) {
    const tags = new Set(this.rolesFor(winner));
    const awards = {};
    for (const [node, role] of Object.entries(this.roleAssignment || {})) {
      if (role && tags.has(role.key)) {
        this.scores[node] = (this.scores[node] || 0) + 1;
        awards[node] = 1;
      }
    }
    return awards;
  }

  /** Catalyst scoring (cycles 1-4): +1 to the Catalyst on a >= 10 point GDW swing. */
  awardCatalystPoints(previousGdw, realizedGdw) {
    if (!catalystScores(previousGdw, realizedGdw)) return {};
    const awards = {};
    for (const [node, role] of Object.entries(this.roleAssignment || {})) {
      if (role && role.key === 'catalyst') {
        this.scores[node] = (this.scores[node] || 0) + 1;
        awards[node] = 1;
      }
    }
    return awards;
  }

  /**
   * End-screen breakdown per node: { node: { total, perCycle: [{ cycle, role, catalyst }] } }.
   * Server-side only: it reveals who scored, so it is never broadcast mid-game.
   */
  scoreBreakdown() {
    const out = {};
    for (const node of Object.keys(this.players)) {
      out[node] = {
        total: this.scores[node] || 0,
        perCycle: this.scoreLedger.map((e) => ({ cycle: e.cycle, role: e.role[node] || 0, catalyst: e.catalyst[node] || 0 }))
      };
    }
    return out;
  }

  /**
   * RESOLUTION: close voting, run the simulation (stub until server/sim is
   * merged) on the winning option and broadcast 'resolution' once the Loom's
   * narration is ready. A safety timer starts immediately so a slow Loom
   * never stalls the game; once the payload is out, the timer restarts for
   * the full RESOLUTION duration so the 20 s month-by-month animation plays.
   */
  startResolutionPhase() {
    this.votingOpen = false;
    const { totals, tie, abstained, winner: provisional } = this.tallyVotes();
    let winner = provisional;
    const previousGdw = this.gdw;

    let simResult;
    if (tie) {
      // Tie (e.g. 3-3 after an Override): forecast both options, keep the
      // one with the higher median GDW and reuse its run as the resolution.
      const sims = { A: this.runSimulation('A'), B: this.runSimulation('B') };
      winner = breakTie(sims.A, sims.B);
      simResult = sims[winner];
    } else {
      simResult = this.runSimulation(winner);
    }
    const option = this.optionFor(winner);
    const stateBefore = this.simState;
    this.applySimResult(simResult);
    this.voteHistory[this.cycle] = winner;
    // Loom Shutdown: GDW hit 0, so the remaining cycles are skipped and the
    // game goes straight from this RESOLUTION to END (Shutdown Ending).
    if (this.gdw <= 0) {
      this.ending = 'shutdown';
      console.log(`[game ${this.roomCode}] Loom shutdown in cycle ${this.cycle}`);
    }
    // The Assembly (2A) makes society volatile for every remaining cycle.
    if (typeof option.volatility === 'number') this.volatility = option.volatility;
    else if (this.cycle === 2 && winner === 'A') this.volatility = ASSEMBLY_VOLATILITY;
    // Cycles 1 and 2 decide the world for cycles 3-5.
    if (this.cycle === 2) this.worldKey = computeWorldKey(this.voteHistory[1], this.voteHistory[2]);
    // Binary scoring in cycles 1-4, and in a cycle 5 that fell back to A/B.
    const binaryScoring = this.cycle < TOTAL_CYCLES || this.finaleFallback;
    const roleAwards = binaryScoring ? this.awardRolePoints(winner) : {};
    const catalystAwards = binaryScoring ? this.awardCatalystPoints(previousGdw, this.gdw) : {};
    this.scoreLedger.push({ cycle: this.cycle, winner, role: roleAwards, catalyst: catalystAwards });
    // Private per-phone score updates (never broadcast: they would hint at
    // roles), sent right after the resolution payload.
    const scoreUpdates = Object.keys(this.players).map((node) => {
      const role = roleAwards[node] || 0;
      const catalyst = catalystAwards[node] || 0;
      return { node, cycle: this.cycle, gained: role + catalyst, role, catalyst, total: this.scores[node] || 0 };
    });

    // Safety timer: the Loom's own timeout plus the full animation, so even a
    // stalled narration can never hold the game in RESOLUTION.
    const resolutionMs = this.durations.RESOLUTION;
    this.enterPhase(PHASES.RESOLUTION, {}, resolutionMs + LOOM_BUDGET_MS);

    // Trace: winning policy and realized GDW (no roles, no per-node votes).
    console.log(`[game ${this.roomCode}] cycle ${this.cycle} resolved: ${winner} "${option.name}"${tie ? ' (tie-break)' : ''}; GDW ${previousGdw} -> ${this.gdw}`);
    // Fixed Crisis 2B: who now holds power depends on Cycle 1 (the Loom after
    // 1A, the Owners' Board after 1B), with its own projector line.
    const worldNote = this.byCycle1World(option.worldNotes);
    const governance = worldNote
      ? { holder: (this.voteHistory[1] || 'A') === 'A' ? 'loom' : 'board', line: String(worldNote.loomLine || '') }
      : null;
    const result = { cycle: this.cycle, winner, totals, tie, abstained, governance, policy: option.name, previousGdw, gdwDelta: Math.round((this.gdw - previousGdw) * 10) / 10 };
    return this.narrateAndBroadcast({ phase: PHASES.RESOLUTION, durationMs: resolutionMs, result, option, simResult, stateBefore, scoreUpdates });
  }

  /**
   * Shared end of a resolution (binary cycles and the finale): narrate with
   * citizens carrying their cohort moods, broadcast the sanitized
   * 'resolution' payload, restart the phase timer for the full animation,
   * then send each phone its private score update. Never rejects.
   */
  narrateAndBroadcast({ phase, durationMs, result, option, simResult, stateBefore, scoreUpdates }) {
    const cycleAtStart = this.cycle;
    const gameIdAtStart = this.gameId;
    // Each citizen carries their cohort's simulated mood and biggest trait
    // change, so the Loom's messages match the numbers.
    const moods = new Map(sim.citizenMoods(stateBefore, this.simState, this.data.citizens).map((m) => [m.id, m]));
    const citizens = (this.data.citizens || []).map((c) => ({ ...c, ...(moods.get(c.id) || {}) }));
    const context = { crisis: this.publicCrisis(), winningOption: option, simSummary: simResult.summary, worldKey: this.worldKey, citizens };
    return Promise.resolve()
      .then(() => resolveLoom().narrate(context))
      .catch((err) => {
        console.error(`[game ${this.roomCode}] narration failed: ${err.message}`);
        return loomStub.narrate(context);
      })
      .then(async (narration) => {
        // A narration without a usable Loom line is treated as a failure.
        if (!narration || typeof narration.loomLine !== 'string' || !narration.loomLine) {
          console.error(`[game ${this.roomCode}] narration returned no loomLine; using fallback`);
          narration = await loomStub.narrate(context);
        }
        // Stale: the game was reset or moved on while the Loom was thinking.
        if (this.gameId !== gameIdAtStart || this.cycle !== cycleAtStart) return null;
        // Only aggregate totals leave the server; sanitizing strips any
        // per-node vote or Override field that might slip into the payload.
        this.lastResolution = sanitizeForBroadcast({
          result,
          gdw: this.gdw,
          forecast: simResult.forecast,
          realized: simResult.realized,
          districts: simResult.realized.districts || [],
          loomLine: narration.loomLine,
          // Reactions carry the citizen's public name, age and district for the feed.
          messages: (narration.messages || []).filter((m) => m && m.text).map((m) => this.citizenMessage(m))
        }, ['name']);
        // The month-by-month animation starts when clients receive this
        // payload, so the next INCIDENT waits the full RESOLUTION duration from now.
        if (this.phase === phase && this.cycle === cycleAtStart) {
          this.lastResolution.endsAt = this.startPhaseTimer(durationMs, () => this.advancePhase());
        }
        this.emit('resolution', this.lastResolution);
        for (const update of scoreUpdates) this.emit('score:update', update);
        return this.lastResolution;
      })
      .catch((err) => {
        // Never leave an unhandled rejection: advancePhase ignores this promise.
        console.error(`[game ${this.roomCode}] resolution broadcast failed: ${err.message}`);
        return null;
      });
  }

  /** Public description of the current world: { worldKey, name, tagline, problemLeft }. */
  worldInfo() {
    const worlds = (this.data.crises && this.data.crises.worlds) || {};
    const w = worlds[this.worldKey] || {};
    return { worldKey: this.worldKey, name: w.name || this.worldKey || '', tagline: w.tagline || '', problemLeft: w.problemLeft || '' };
  }

  /**
   * WORLD_REVEAL (10 s, after Cycle 2's RESOLUTION): name the world the first
   * two votes built and the problem it leaves. Emits 'world:reveal'.
   */
  startWorldRevealPhase() {
    const reveal = this.worldInfo();
    this.enterPhase(PHASES.WORLD_REVEAL, { world: reveal });
    this.emit('world:reveal', reveal);
    console.log(`[game ${this.roomCode}] world revealed: ${reveal.worldKey} (${reveal.name})`);
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
    this.simCache = {};
    this.crisis = null;
    this.lastResolution = null;
    if (cycleNumber === 1) {
      this.simState = createSimState(this.data.sim);
      this.gdw = this.simState ? roundGdw(sim.computeGDW(this.simState)) : STARTING_GDW;
      this.gdwHistory = [this.gdw];
      this.volatility = 1.0;
      this.voteHistory = {};
      this.worldKey = null;
      this.ending = null;
      this.scoreLedger = [];
      for (const node of Object.keys(this.scores)) this.scores[node] = 0;
    }
    console.log(`[game ${this.roomCode}] cycle ${cycleNumber} begins (GDW ${this.gdw})`);
  }

  /**
   * Reset for a new session in the same room: back to LOBBY with a new game
   * id (fresh seeds), all cycle counters, Overrides, scores, volatility and
   * world cleared. Seated players keep their node and reconnect token but
   * must ready up again. Broadcasts the LOBBY phase.
   */
  resetGame() {
    this.clearPhaseTimer();
    this.gameId = generateGameId();
    this.phase = PHASES.LOBBY;
    this.cycle = 0;
    this.crisis = null;
    this.votes = {};
    this.votingOpen = false;
    this.simCache = {};
    this.lastResolution = null;
    this.simState = null;
    this.gdw = STARTING_GDW;
    this.gdwHistory = [];
    this.volatility = 1.0;
    this.worldKey = null;
    this.ending = null;
    this.voteHistory = {};
    this.scoreLedger = [];
    this.roleAssignment = null;
    this.finaleFallback = false;
    this.startedAt = null;
    for (const [node, player] of Object.entries(this.players)) {
      player.ready = false;
      player.role = null;
      this.scores[node] = 0;
      this.overridesUsed[node] = false;
    }
    console.log(`[game ${this.roomCode}] reset (gameId ${this.gameId})`);
    this.emit('phase', { cycle: 0, phase: PHASES.LOBBY, endsAt: null, crisis: null });
    return true;
  }

  /**
   * Public citizen fields for a feed item: { citizenId, name, age, district, text, sentiment }.
   * Citizens are fictional, so their names are safe to show on the projector.
   */
  citizenMessage(item) {
    const citizens = Array.isArray(this.data.citizens) ? this.data.citizens : [];
    const c = citizens.find((x) => x.id === item.citizenId) || {};
    const sim = this.data.sim || {};
    const district = (sim.districts || REGION.districts).find((d) => d.id === c.district);
    const cohort = (sim.cohorts || []).find((k) => k.id === c.cohort);
    return {
      citizenId: item.citizenId,
      name: c.name || item.citizenId || 'Citizen',
      age: typeof c.age === 'number' ? c.age : null,
      district: c.district || null,
      districtName: district ? district.name : null,
      cohort: cohort ? cohort.name : null,
      text: String(item.text || ''),
      sentiment: item.sentiment || null
    };
  }

  /** Crisis fields safe to show everyone (no effects, roles or intel). */
  publicCrisis() {
    if (!this.crisis) return null;
    const { id, title, subtitle, incident, loomIntro } = this.crisis;
    // The classroom debate hook (e.g. "Who should own the machines?").
    const debateHook = String(this.crisis.teacherPrompt || '').replace(/^Classroom Debrief:\s*/i, '');
    const feed = (this.crisis.feed || []).filter((f) => f && f.text).map((f) => this.citizenMessage(f));
    // mode tells clients a write-in finale ("writein") from an A/B vote.
    const mode = this.crisis.mode === 'writein' && !this.finaleFallback ? 'writein' : 'binary';
    return { id, title, subtitle, incident, loomIntro, mode, debateHook, debateHooks: this.crisis.debateHooks || [], feed };
  }

  /**
   * Non-secret snapshot for the /api/state debug endpoint: no names, roles,
   * tokens, per-node votes, Override usage, scores or effect vectors.
   */
  debugState() {
    return {
      roomCode: this.roomCode,
      gameId: this.gameId,
      phase: this.phase,
      cycle: this.cycle,
      endsAt: this.endsAt,
      gdw: this.gdw,
      gdwHistory: this.gdwHistory.slice(),
      volatility: this.volatility,
      worldKey: this.worldKey,
      voteHistory: { ...this.voteHistory },
      ending: this.ending,
      crisis: this.publicCrisis(),
      voted: Object.keys(this.votes),
      players: Object.values(this.players).map((p) => ({ node: p.node, ready: p.ready, connected: p.connected }))
    };
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
      token: crypto.randomBytes(16).toString('hex'), // private reconnect token
      joinedAt: Date.now()
    };
    this.scores[node] = 0;
    this.overridesUsed[node] = false;
    console.log(`[game ${this.roomCode}] ${node} joined`);
    return { ok: true, node, token: this.players[node].token };
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

  /**
   * Mark a node as disconnected. Its slot, role, votes and score are kept so
   * the phone can reconnect into the same seat.
   */
  markDisconnected(node) {
    const player = this.players[node];
    if (!player) return false;
    player.connected = false;
    player.socketId = null;
    console.log(`[game ${this.roomCode}] ${node} disconnected`);
    return true;
  }

  /** Find the node whose private reconnect token matches, or null. */
  findNodeByToken(token) {
    if (typeof token !== 'string' || !token) return null;
    const player = Object.values(this.players).find((p) => p.token === token);
    return player ? player.node : null;
  }

  /** Bind a reconnecting phone's new socket to its existing node. */
  reconnectPlayer(node, socketId) {
    const player = this.players[node];
    if (!player) return false;
    player.socketId = socketId;
    player.connected = true;
    console.log(`[game ${this.roomCode}] ${node} reconnected`);
    return true;
  }

  /** Find the node id a socket is seated at, or null. */
  findNodeBySocket(socketId) {
    const player = Object.values(this.players).find((p) => p.socketId === socketId);
    return player ? player.node : null;
  }
}

// ---------------------------------------------------------------------------
// Room registry: one GameState per room code.
// ---------------------------------------------------------------------------

const rooms = new Map();

/** Create a room with a fresh, unused 4-letter code. */
function createRoom(options = {}) {
  const roomCode = generateRoomCode(rooms);
  const game = new GameState({ ...options, roomCode });
  rooms.set(roomCode, game);
  return game;
}

/** Look up a room by code (case-insensitive). */
function getRoom(roomCode) {
  return rooms.get(String(roomCode || '').toUpperCase()) || null;
}

/** The most recently created room still open (the classroom's projector). */
function getLatestRoom() {
  let latest = null;
  for (const game of rooms.values()) latest = game;
  return latest;
}

/** Remove a room and stop its timers. */
/** Find the room and node holding a reconnect token: { game, node } or null. */
function findSession(token) {
  for (const game of rooms.values()) {
    const node = game.findNodeByToken(token);
    if (node) return { game, node };
  }
  return null;
}

function closeRoom(roomCode) {
  const game = getRoom(roomCode);
  if (!game) return false;
  game.stop();
  game.removeAllListeners();
  return rooms.delete(game.roomCode);
}

// ---------------------------------------------------------------------------
// Smoke test: node -e "require('./server/gameEngine').smokeTest()"
// Drives a room from LOBBY to the cycle 1 RESOLUTION with real timers shrunk
// to a few milliseconds, checking every transition and private event.
// ---------------------------------------------------------------------------

function smokeTest({ quiet = false } = {}) {
  const expected = ['INTRO', 'ROLE_ASSIGN', 'CHAMBER', 'INCIDENT', 'INTEL', 'DEBATE', 'VOTE', 'RESOLUTION'];
  const tiny = {};
  for (const phase of Object.keys(DEFAULT_PHASE_SECONDS)) tiny[phase] = 0.02;
  tiny.RESOLUTION = 60; // hold on RESOLUTION so the test can inspect it

  const log = console.log;
  if (quiet) console.log = () => {};
  const game = new GameState({ roomCode: 'TEST', phaseSeconds: tiny });
  const seen = [];
  const roles = [];
  const intel = [];

  return new Promise((resolve, reject) => {
    const fail = (msg) => { game.clearPhaseTimer(); console.log = log; reject(new Error(msg)); };
    const guard = setTimeout(() => fail(`timed out; reached ${seen.join(' -> ')}`), 5000);

    NODE_IDS.forEach((node, i) => {
      game.addPlayer(`socket-${i}`, `Student ${i + 1}`);
      game.setReady(node, true);
    });
    if (!game.allReady()) return fail('players not ready');

    game.on('role:assigned', (e) => roles.push(e));
    game.on('intel:drop', (e) => intel.push(e));
    game.on('phase', (p) => {
      seen.push(p.phase);
      if (p.phase === 'VOTE') {
        NODE_IDS.forEach((node, i) => game.castVote(node, i < 3 ? 'A' : 'B'));
      }
    });
    game.on('resolution', (r) => {
      clearTimeout(guard);
      game.clearPhaseTimer();
      console.log = log;
      const problems = [];
      if (seen.join() !== expected.join()) problems.push(`phases ${seen.join(' -> ')}`);
      if (roles.length !== 5 || new Set(roles.map((e) => e.role.key)).size !== 5) problems.push('roles not dealt 1 per node');
      if (intel.length !== 5) problems.push('intel not dropped to 5 nodes');
      if (r.result.winner !== 'A') problems.push(`winner ${r.result.winner}, expected A`);
      if (typeof r.gdw !== 'number' || !r.loomLine) problems.push('resolution payload incomplete');
      if (problems.length) return reject(new Error(`smoke test failed: ${problems.join('; ')}`));
      log(`[smoke] OK: LOBBY -> ${seen.join(' -> ')}; winner ${r.result.winner}; GDW ${r.result.previousGdw} -> ${r.gdw}`);
      return resolve({ phases: seen, resolution: r });
    });

    if (!game.startIntroPhase()) fail('could not start');
    return undefined;
  });
}

module.exports = {
  smokeTest,
  GameState,
  rooms,
  createRoom,
  getRoom,
  getLatestRoom,
  findSession,
  closeRoom,
  loadGameData,
  selectCrisis,
  sanitizeForBroadcast,
  normalizeCrisis,
  generateRoomCode,
  generateGameId,
  hashSeed,
  createPrng,
  seededShuffle,
  roleKey,
  resolveSimulate,
  createSimState,
  breakTie,
  forecastMedianEnd,
  computeWorldKey,
  catalystScores,
  bordaCount,
  rankBorda,
  selectEnacted,
  packageEffects,
  FINALE_WEIGHTS,
  BORDA_POINTS,
  roundGdw,
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
  DEFAULT_FINALE_POLICY,
  PLACEHOLDER_POLICY,
  buildPhaseDurations
};
