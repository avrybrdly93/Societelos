'use strict';

// Societelos — Stream 1 Socket.IO layer.
// Translates client events into gameEngine calls and relays engine events
// back to the right sockets. Holds no game state of its own.

const CLIENT_TYPES = ['host', 'phone'];

/** Socket.IO room names for a game. */
const roomChannel = (code) => `room:${code}`;
const hostChannel = (code) => `host:${code}`;

/**
 * Work out whether a socket is the projector ('host') or a controller
 * ('phone') from the handshake (auth first, then query string). Defaults to phone.
 */
function detectClientType(socket) {
  const hs = socket.handshake || {};
  const raw = (hs.auth && hs.auth.clientType) || (hs.query && hs.query.clientType);
  return CLIENT_TYPES.includes(raw) ? raw : 'phone';
}

/**
 * Wire Socket.IO to the game engine.
 * @param {import('socket.io').Server} io
 * @param {object} gameEngine the server/gameEngine.js module (room registry + GameState)
 */
function initSockets(io, gameEngine) {
  const wiredRooms = new WeakSet();

  // Subscribe once per room to engine events and relay them to clients.
  function wireRoom(game) {
    if (wiredRooms.has(game)) return;
    wiredRooms.add(game);
  }

  function handleHost(socket) {
    const requested = socket.handshake.auth && socket.handshake.auth.roomCode;
    const game = gameEngine.getRoom(requested) || gameEngine.createRoom();
    wireRoom(game);
    socket.data.roomCode = game.roomCode;
    socket.join([roomChannel(game.roomCode), hostChannel(game.roomCode)]);
    socket.emit('host:room', { roomCode: game.roomCode, gameId: game.gameId, phase: game.phase });
    console.log(`[socket] host connected to room ${game.roomCode}`);
  }

  function handlePhone(socket) {
    socket.emit('client:type', { clientType: 'phone' });
  }

  io.on('connection', (socket) => {
    const clientType = detectClientType(socket);
    socket.data.clientType = clientType;
    if (clientType === 'host') handleHost(socket);
    else handlePhone(socket);
  });

  return io;
}

module.exports = { initSockets, detectClientType, roomChannel, hostChannel };
