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

/** Role card fields a phone may see (accepts spec and legacy role schemas). */
function roleCard(role) {
  return {
    key: role.key,
    name: role.name || role.designation,
    icon: role.icon || '',
    goal: role.goal || role.agenda || '',
    winCondition: role.winCondition || '',
    cardText: role.cardText || role.archetype || ''
  };
}

/**
 * Wire Socket.IO to the game engine.
 * @param {import('socket.io').Server} io
 * @param {object} gameEngine the server/gameEngine.js module (room registry + GameState)
 */
function initSockets(io, gameEngine) {
  const wiredRooms = new WeakSet();

  // Emit to the socket currently bound to `node`, if it is connected.
  function emitToNode(game, node, event, payload) {
    const player = game.players[node];
    if (player && player.socketId) io.to(player.socketId).emit(event, payload);
  }

  // Subscribe once per room to engine events and relay them to clients.
  function wireRoom(game) {
    if (wiredRooms.has(game)) return;
    wiredRooms.add(game);

    // role:assigned { role } privately to the one phone that holds it.
    game.on('role:assigned', ({ node, role }) => {
      emitToNode(game, node, 'role:assigned', { role: roleCard(role) });
    });
  }

  // lobby:update { players: [{ node, ready, connected }] } to everyone in the room.
  // Names are deliberately left out: the projector shows node ids only.
  function broadcastLobby(game) {
    const players = Object.values(game.players).map((p) => ({ node: p.node, ready: p.ready, connected: p.connected }));
    io.to(roomChannel(game.roomCode)).emit('lobby:update', { players });
  }

  function handleHost(socket) {
    const requested = socket.handshake.auth && socket.handshake.auth.roomCode;
    const game = gameEngine.getRoom(requested) || gameEngine.createRoom();
    wireRoom(game);
    socket.data.roomCode = game.roomCode;
    socket.join([roomChannel(game.roomCode), hostChannel(game.roomCode)]);
    socket.emit('host:room', { roomCode: game.roomCode, gameId: game.gameId, phase: game.phase });
    broadcastLobby(game);
    console.log(`[socket] host connected to room ${game.roomCode}`);

    // host:start {} -> begin the phase flow once all 5 nodes have joined.
    socket.on('host:start', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const joined = Object.keys(game.players).length;
      if (joined < gameEngine.MAX_PLAYERS) {
        socket.emit('host:error', { reason: 'NOT_ENOUGH_PLAYERS', joined });
        return reply({ ok: false, reason: 'NOT_ENOUGH_PLAYERS', joined });
      }
      if (!game.startIntroPhase()) return reply({ ok: false, reason: 'ALREADY_STARTED' });
      return reply({ ok: true });
    });
  }

  // Room a phone targets: the code it sent, else the classroom's latest room.
  function findPhoneRoom(code) {
    return code ? gameEngine.getRoom(code) : gameEngine.getLatestRoom();
  }

  function handlePhone(socket) {
    socket.emit('client:type', { clientType: 'phone' });

    // lobby:join { name, room? } -> seat the phone in a NODE slot.
    socket.on('lobby:join', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string' || !payload.name.trim()) {
        return reply({ ok: false, reason: 'BAD_PAYLOAD' });
      }
      if (socket.data.node) return reply({ ok: false, reason: 'ALREADY_JOINED' });
      const game = findPhoneRoom(payload.room);
      if (!game) return reply({ ok: false, reason: 'NO_ROOM' });
      if (game.phase !== 'LOBBY') return reply({ ok: false, reason: 'GAME_IN_PROGRESS' });

      const seat = game.addPlayer(socket.id, payload.name);
      if (!seat.ok) return reply(seat);

      wireRoom(game);
      socket.data.roomCode = game.roomCode;
      socket.data.node = seat.node;
      socket.join(roomChannel(game.roomCode));
      const joined = { ok: true, node: seat.node, roomCode: game.roomCode };
      socket.emit('lobby:joined', joined);
      reply(joined);
      return broadcastLobby(game);
    });

    // lobby:ready { ready? } -> set or toggle this phone's ready flag.
    socket.on('lobby:ready', (payload) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node || game.phase !== 'LOBBY') return;
      const ready = payload && typeof payload.ready === 'boolean' ? payload.ready : undefined;
      game.setReady(socket.data.node, ready);
      broadcastLobby(game);
    });
  }

  io.on('connection', (socket) => {
    const clientType = detectClientType(socket);
    socket.data.clientType = clientType;
    if (clientType === 'host') handleHost(socket);
    else handlePhone(socket);
  });

  return io;
}

module.exports = { initSockets, detectClientType, roomChannel, hostChannel, roleCard };
