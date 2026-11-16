'use strict';

// Societelos — Stream 1 authoritative game state machine.
// The server is the only source of truth: this module owns game state and
// phase timers. socket.js translates client events into calls on it.

const crypto = require('crypto');

// Room codes: 4 uppercase letters, without the easily confused O and I
// (digits are never used, so 0 and 1 cannot appear either).
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 4;

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
 * State for one game room (one projector + 5 phones).
 */
class GameState {
  constructor({ roomCode = null } = {}) {
    this.roomCode = roomCode;
    this.gameId = null;
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
}

module.exports = { GameState, generateRoomCode, ROOM_CODE_ALPHABET };
