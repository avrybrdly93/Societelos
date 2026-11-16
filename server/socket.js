'use strict';

// Societelos — Stream 1 Socket.IO layer.
// Translates client events into gameEngine calls and relays engine events
// back to the right sockets. Holds no game state of its own.

/**
 * Wire Socket.IO to the game engine.
 * @param {import('socket.io').Server} io
 * @param {object} gameEngine the server/gameEngine.js module (room registry + GameState)
 */
function initSockets(io, gameEngine) {
  io.on('connection', (socket) => {
    // Event handlers are registered per client type in the following tasks.
    socket.data.gameEngine = gameEngine;
  });
  return io;
}

module.exports = { initSockets };
