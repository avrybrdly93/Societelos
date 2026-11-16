'use strict';

// Societelos — Stream 1 authoritative game state machine.
// The server is the only source of truth: this module owns game state and
// phase timers. socket.js translates client events into calls on it.

const crypto = require('crypto');

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

  /** Find the node id a socket is seated at, or null. */
  findNodeBySocket(socketId) {
    const player = Object.values(this.players).find((p) => p.socketId === socketId);
    return player ? player.node : null;
  }
}

module.exports = {
  GameState,
  generateRoomCode,
  generateGameId,
  hashSeed,
  ROOM_CODE_ALPHABET,
  NODE_IDS,
  MAX_PLAYERS
};
