'use strict';

// Societelos — Stream 1 authoritative game state machine.
// The server is the only source of truth: this module owns game state and
// phase timers. socket.js translates client events into calls on it.

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

module.exports = { GameState };
