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
 * Payload validation. A schema maps field -> rule, where a rule is a type name
 * ('string' | 'boolean' | 'number' | 'array'), optionally suffixed with '?' for
 * optional fields, or a function returning true when the value is valid.
 * Returns true when `payload` is a plain object matching the schema.
 */
function isValidPayload(payload, schema = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  for (const [field, rule] of Object.entries(schema)) {
    const value = payload[field];
    if (typeof rule === 'function') {
      if (!rule(value)) return false;
      continue;
    }
    const optional = rule.endsWith('?');
    const type = optional ? rule.slice(0, -1) : rule;
    if (value === undefined || value === null) {
      if (optional) continue;
      return false;
    }
    if (type === 'array' ? !Array.isArray(value) : typeof value !== type) return false;
  }
  return true;
}

/**
 * Register a handler that silently ignores malformed packets: the payload is
 * validated against `schema` first (an empty payload counts as {}), handler
 * errors are caught so one bad packet can't crash the server, and an ack
 * callback, if sent, always gets a reply.
 */
function onValid(socket, event, schema, handler) {
  socket.on(event, (payload, ack) => {
    // A client that emits with only an ack callback sends the callback first.
    if (typeof payload === 'function') {
      ack = payload;
      payload = undefined;
    }
    const reply = typeof ack === 'function' ? ack : () => {};
    const body = payload === undefined || payload === null ? {} : payload;
    if (!isValidPayload(body, schema)) return reply({ ok: false, reason: 'BAD_PAYLOAD' });
    try {
      return handler(body, reply);
    } catch (err) {
      console.error(`[socket] ${event} handler failed: ${err.message}`);
      return reply({ ok: false, reason: 'SERVER_ERROR' });
    }
  });
}

const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 64;

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

    // phase { cycle, phase, endsAt, crisis, ... } to everyone in the room.
    game.on('phase', (payload) => {
      io.to(roomChannel(game.roomCode)).emit('phase', payload);
    });

    // role:assigned { role } privately to the one phone that holds it.
    game.on('role:assigned', ({ node, role }) => {
      emitToNode(game, node, 'role:assigned', { role: roleCard(role) });
    });

    // resolution { result, gdw, forecast, realized, districts, loomLine, messages } to the room.
    game.on('resolution', (payload) => {
      io.to(roomChannel(game.roomCode)).emit('resolution', payload);
    });

    // world:reveal { worldKey, name, problemLeft } to the room after Cycle 2.
    game.on('world:reveal', ({ worldKey, name, tagline, problemLeft }) => {
      io.to(roomChannel(game.roomCode)).emit('world:reveal', { worldKey, name, tagline, problemLeft });
    });

    // override:status { overrideAvailable } privately to each phone as VOTE opens.
    game.on('override:status', ({ node, overrideAvailable }) => {
      emitToNode(game, node, 'override:status', { overrideAvailable: !!overrideAvailable });
    });

    // intel:drop { text } privately, chosen by the node's secret role.
    game.on('intel:drop', ({ node, text }) => {
      emitToNode(game, node, 'intel:drop', { text });
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
    onValid(socket, 'host:start', {}, (payload, reply) => {
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

  // Rebind a phone to its seat using its private token. Returns true on success.
  function resumeSession(socket, token) {
    const session = gameEngine.findSession(token);
    if (!session) return false;
    const { game, node } = session;
    wireRoom(game);
    game.reconnectPlayer(node, socket.id);
    socket.data.roomCode = game.roomCode;
    socket.data.node = node;
    socket.join(roomChannel(game.roomCode));
    const role = game.players[node].role;
    socket.emit('session:resumed', {
      node,
      roomCode: game.roomCode,
      cycle: game.cycle,
      phase: game.phase,
      endsAt: game.endsAt,
      role: role ? roleCard(role) : null
    });
    broadcastLobby(game);
    return true;
  }

  function handlePhone(socket) {
    socket.emit('client:type', { clientType: 'phone' });

    // Reconnect support: a phone that stored its token sends it in the handshake
    // (auth.token) or later via session:resume { token }.
    const handshakeToken = socket.handshake.auth && socket.handshake.auth.token;
    if (handshakeToken && !resumeSession(socket, handshakeToken)) {
      socket.emit('session:invalid', {});
    }
    onValid(socket, 'session:resume', { token: nonEmptyString }, (payload, reply) => {
      const ok = resumeSession(socket, payload.token);
      if (!ok) socket.emit('session:invalid', {});
      reply({ ok });
    });

    // lobby:join { name, room? } -> seat the phone in a NODE slot.
    onValid(socket, 'lobby:join', { name: nonEmptyString, room: 'string?' }, (payload, reply) => {
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
      const joined = { ok: true, node: seat.node, roomCode: game.roomCode, token: seat.token };
      socket.emit('lobby:joined', joined);
      reply(joined);
      return broadcastLobby(game);
    });

    // vote:cast { choice: 'A' | 'B', override: bool } -> record a blind vote.
    const voteSchema = { choice: (v) => v === 'A' || v === 'B', override: 'boolean?' };
    onValid(socket, 'vote:cast', voteSchema, (payload, reply) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node) return reply({ ok: false, reason: 'NOT_JOINED' });
      const result = game.castVote(socket.data.node, payload.choice, payload.override === true);
      reply(result);
      // vote:progress { voted: [node] } -> who has locked in (never their choice).
      if (result.ok) io.to(roomChannel(game.roomCode)).emit('vote:progress', { voted: Object.keys(game.votes) });
      // Early advance: end VOTE as soon as all 5 nodes have voted.
      if (result.ok && game.phase === 'VOTE' && game.allVotesIn()) game.advancePhase();
      return undefined;
    });

    // Disconnect: keep the seat and all game state; just flag it offline.
    socket.on('disconnect', () => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node) return;
      const player = game.players[socket.data.node];
      // Ignore if the node has already reconnected on a newer socket.
      if (!player || player.socketId !== socket.id) return;
      game.markDisconnected(socket.data.node);
      broadcastLobby(game);
    });

    // lobby:ready { ready? } -> set or toggle this phone's ready flag.
    onValid(socket, 'lobby:ready', { ready: 'boolean?' }, (payload, reply) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node || game.phase !== 'LOBBY') return reply({ ok: false, reason: 'NOT_IN_LOBBY' });
      const ready = game.setReady(socket.data.node, payload.ready);
      reply({ ok: true, ready });
      return broadcastLobby(game);
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

module.exports = { initSockets, detectClientType, roomChannel, hostChannel, roleCard, isValidPayload };
