'use strict';

// Societelos — Stream 1 Socket.IO layer.
// Translates client events into gameEngine calls and relays engine events
// back to the right sockets. Holds no game state of its own.
//
// Clients (handshake auth.clientType): 'host' (projector), 'phone' (one of
// the five seats) or 'spectator' (read-only). Every inbound event is checked
// by onValid(): rate limit, payload schema, and a crash-proof handler.
//
//   host -> server    host:start { seed? }, host:skipIntro, host:narrated, host:config, host:playAgain,
//                     host:toggleBots, host:configureSession, host:triggerFinale
//   phone -> server   lobby:join, lobby:ready, session:resume, spectate:join,
//                     vote:cast, debate:ready, finale:submit, finale:rank
//   server -> room    phase, lobby:update, resolution, world:reveal, game:end,
//                     vote:progress, debate:progress, finale:progress, host:config
//   server -> room    council, scores, loom:line (public: characters are public)
//   server -> one     role:assigned, override:status, score:update,
//                     finale:feedback, finale:ballot, state:sync (reconnect)
//   server -> host    host:room, host:sync (projector refresh), host:error

const crypto = require('crypto');
const CLIENT_TYPES = ['host', 'phone', 'spectator'];

/**
 * Socket.IO room names for a game: everyone in the game (host, phones,
 * spectators) is in roomChannel; the projector is also in hostChannel,
 * reserved for host-only broadcasts (none needed for the MVP).
 */
const roomChannel = (code) => `room:${code}`;
const hostChannel = (code) => `host:${code}`;

/**
 * Work out whether a socket is the projector ('host'), a controller
 * ('phone') or a read-only 'spectator' from the handshake (auth first, then
 * query string). Defaults to phone.
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

// Per-client rate limit (token bucket): bursts of up to RATE_BURST events,
// refilled at RATE_PER_SECOND. Stops button-mashing floods from one phone.
const RATE_BURST = 10;
const RATE_PER_SECOND = 5;

/** True if `socket` may send another event now; consumes one token if so. */
function allowEvent(socket, now = Date.now()) {
  const bucket = socket.data.rate || (socket.data.rate = { tokens: RATE_BURST, at: now });
  bucket.tokens = Math.min(RATE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_SECOND);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
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
    if (!allowEvent(socket)) return reply({ ok: false, reason: 'RATE_LIMITED' });
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

// Finale payload schemas: bounded, so an oversized or malformed packet is
// refused before it reaches the engine (the engine re-validates contents).
const FINALE_SCHEMAS = Object.freeze({
  submit: { text: (v) => typeof v === 'string' && v.length <= 1000 },
  rank: { order: (v) => Array.isArray(v) && v.length <= 10 && v.every((id) => typeof id === 'string' && id.length <= 32) }
});

/** Role card fields a phone may see (accepts spec and legacy role schemas). */
// Polite refusals for a phone that cannot take a seat (e.g. a 6th student).
// The seated five are never touched; the phone may still watch the projector.
const JOIN_REFUSALS = Object.freeze({
  GAME_IN_PROGRESS: 'GAME IN PROGRESS. This council already has its five councilpersons. Watch the screen; you can join the next game.',
  ROOM_FULL: 'COUNCIL FULL. All five seats are taken. Watch the screen; you can join the next game.'
});

function joinRefusal(reason) {
  return { ok: false, reason, message: JOIN_REFUSALS[reason] || 'Could not join this council.', canSpectate: reason in JOIN_REFUSALS };
}

/** The game:end broadcast: the spec's keys first, then End Screen extras. */
const GAME_END_KEYS = Object.freeze([
  'gdwHistory', 'finalGdw', 'grade', 'worldKey', 'worldName', 'closingMessage',
  'roles', 'authors', 'scores', 'winner', 'shutdown', 'seed',
  'gameId', 'gradeText', 'cycleMarkers', 'cycleSeeds', 'cyclesPlayed', 'sharedWin', 'finaleMode', 'finaleFallback',
  'champion', 'maxScore', 'startYear'
]);

function gameEndPayload(data = {}) {
  const out = {};
  for (const key of GAME_END_KEYS) if (data[key] !== undefined) out[key] = data[key];
  return out;
}

function roleCard(role) {
  return {
    key: role.key,
    name: role.name || role.designation,
    icon: role.icon || '',
    goal: role.goal || role.agenda || '',
    winCondition: role.winCondition || '',
    cardText: role.cardText || role.archetype || '',
    motto: role.motto || '',
    seat: role.seat || '',
    portrait: role.portrait || '',
    ideas: role.ideas || null,
    groupWeight: Number.isFinite(role.groupWeight) ? role.groupWeight : null
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
      if (payload.phase === 'DEBATE') {
        io.to(roomChannel(game.roomCode)).emit('debate:progress', {
          ready: [],
          count: 0,
          total: Object.keys(game.players).length
        });
      }
      if (game.botsEnabled) {
        if (payload.phase === 'VOTE') {
          triggerBotVotes(game);
        } else if (payload.phase === 'FINALE_WRITE') {
          triggerBotSubmissions(game);
        } else if (payload.phase === 'FINALE_RANK') {
          triggerBotRankings(game);
        }
      }
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

    // score:update { cycle, gained, personal, group, total } to its phone.
    game.on('score:update', ({ node, cycle, gained, personal, group, total }) => {
      emitToNode(game, node, 'score:update', { cycle, gained, personal, group, total });
    });

    // council { members } to the room: the five seats and their public characters.
    game.on('council', (payload) => {
      io.to(roomChannel(game.roomCode)).emit('council', payload);
    });

    // scores { cycle, rows, maxTotal } to the room after every round.
    game.on('scores', (payload) => {
      io.to(roomChannel(game.roomCode)).emit('scores', payload);
    });

    // loom:line { cycle, year, phase, kind, text } to the room: the Loom's live feed.
    game.on('loom:line', (line) => {
      io.to(roomChannel(game.roomCode)).emit('loom:line', line);
    });

    // finale:feedback { status, feedback } privately to the author asked to revise.
    game.on('finale:feedback', ({ node, status, feedback }) => {
      emitToNode(game, node, 'finale:feedback', { status, feedback });
      if (status === 'revise' && game.players[node] && game.players[node].isBot) {
        setTimeout(() => {
          if (game.phase === 'FINALE_MOD' && game.finale && game.finale.revise[node] === 'pending') {
            const current = game.finale.submissions[node];
            game.resubmitPolicy(node, `Revised: ${current || 'Resource equilibrium policy'}`);
          }
        }, 500);
      }
    });

    // finale:ballot { policies: [{ id, text }] x4 } privately to each phone.
    game.on('finale:ballot', ({ node, policies }) => {
      emitToNode(game, node, 'finale:ballot', { policies });
    });

    // game:end { gdwHistory, finalGdw, grade, worldKey, worldName,
    // closingMessage, roles, authors, scores, winner, shutdown, seed } to the
    // room once END starts: the game is over, so roles and authors are revealed.
    game.on('game:end', (data) => {
      io.to(roomChannel(game.roomCode)).emit('game:end', gameEndPayload(data));
    });
  }

  function triggerBotVotes(game) {
    const isFast = game.durations && (game.durations.VOTE < 1000 || game.durations.DEBATE < 1000);
    const bots = Object.values(game.players).filter((p) => p.isBot);
    bots.forEach((bot, idx) => {
      const delay = isFast ? 1 * (idx + 1) : (600 + idx * 450);
      setTimeout(() => {
        if (game.phase !== 'VOTE' || !game.votingOpen || game.votes[bot.node]) return;
        const choice = crypto.randomInt(0, 2) === 0 ? 'A' : 'B';
        const result = game.castVote(bot.node, choice, false);
        if (result.ok) {
          io.to(roomChannel(game.roomCode)).emit('vote:progress', { voted: Object.keys(game.votes) });
          if (game.allVotesIn() && game.phase === 'VOTE') {
            game.advancePhase();
          }
        }
      }, delay);
    });
  }

  function triggerBotSubmissions(game) {
    const isFast = game.durations && game.durations.FINALE_WRITE < 1000;
    const canned = [
      'Autonomous surplus dividend for residential commons and microgrids.',
      'Decentralize computational routing across regional open-access nodes.',
      'Universal cultural sabbatical grants and creative work endowments.',
      'Algorithmic resource equilibrium protocol for municipal trusts.'
    ];
    const bots = Object.values(game.players).filter((p) => p.isBot);
    bots.forEach((bot, idx) => {
      const delay = isFast ? 1 * (idx + 1) : (800 + idx * 400);
      setTimeout(() => {
        if (game.phase !== 'FINALE_WRITE' || !game.finale || !game.finale.writingOpen) return;
        if (game.finale.submissions[bot.node]) return;
        const text = canned[idx % canned.length];
        game.submitPolicy(bot.node, text);
      }, delay);
    });
  }

  function triggerBotRankings(game) {
    const isFast = game.durations && game.durations.FINALE_RANK < 1000;
    const bots = Object.values(game.players).filter((p) => p.isBot);
    bots.forEach((bot, idx) => {
      const delay = isFast ? 1 * (idx + 1) : (800 + idx * 400);
      setTimeout(() => {
        if (game.phase !== 'FINALE_RANK' || !game.finale || !game.finale.rankingOpen) return;
        if (game.finale.ranks[bot.node]) return;
        const ballot = (game.finale.ballots && game.finale.ballots[bot.node]) || [];
        if (ballot.length === 4) {
          const order = ballot.slice().sort(() => (crypto.randomInt(0, 2) === 0 ? -1 : 1));
          game.rankPolicies(bot.node, order);
        }
      }, delay);
    });
  }

  // lobby:update { players: [{ node, ready, connected, isBot }], botsEnabled } to everyone in the room.
  // Names are deliberately left out: the projector shows node ids only.
  function broadcastLobby(game) {
    const players = Object.values(game.players).map((p) => ({
      node: p.node,
      ready: p.ready,
      connected: p.connected,
      isBot: !!p.isBot
    }));
    io.to(roomChannel(game.roomCode)).emit('lobby:update', {
      players,
      botsEnabled: !!game.botsEnabled,
      sessionTimerEnabled: !!game.sessionTimerEnabled,
      sessionDurationSec: game.sessionDurationSec
    });
  }

  // Demo mode: one fixed room (DEMO_ROOM, 'LOOM' under npm start). Every host
  // screen and every phone uses it, so nobody can land in a different room.
  const demoRoom = () => String(process.env.DEMO_ROOM || '').trim().toUpperCase();

  function handleHost(socket) {
    const demo = demoRoom();
    const requested = demo || (socket.handshake.auth && socket.handshake.auth.roomCode);
    const game = gameEngine.getRoom(requested) || gameEngine.createRoom(demo ? { roomCode: demo } : {});
    wireRoom(game);
    socket.data.roomCode = game.roomCode;
    socket.join([roomChannel(game.roomCode), hostChannel(game.roomCode)]);
    socket.emit('host:room', {
      roomCode: game.roomCode,
      gameId: game.gameId,
      phase: game.phase,
      botsEnabled: !!game.botsEnabled,
      sessionTimerEnabled: !!game.sessionTimerEnabled,
      sessionDurationSec: game.sessionDurationSec,
      config: game.getConfig()
    });
    // A projector reloading mid-game gets the world it missed.
    if (game.worldKey) socket.emit('world:reveal', game.worldInfo());
    broadcastLobby(game);
    // ...and the current phase, the GDW line so far and the active
    // resolution or game:end, so the screen redraws where the class is.
    for (const [event, payload] of game.hostSync()) {
      socket.emit(event, event === 'game:end' ? gameEndPayload(payload) : payload);
    }
    console.log(`[socket] host connected to room ${game.roomCode}`);

    // host:toggleBots { enabled: boolean } -> dev mode toggle to fill remaining slots with bots
    onValid(socket, 'host:toggleBots', { enabled: 'boolean' }, (payload, reply) => {
      game.enableBots(payload.enabled);
      broadcastLobby(game);
      reply({ ok: true, botsEnabled: game.botsEnabled });
    });

    // host:configureSession { enabled: boolean, durationSec: number? } -> configure blitz mode
    onValid(socket, 'host:configureSession', { enabled: 'boolean', durationSec: 'number?' }, (payload, reply) => {
      game.setSessionMode(payload.enabled, payload.durationSec);
      broadcastLobby(game);
      reply({ ok: true, sessionTimerEnabled: game.sessionTimerEnabled, sessionDurationSec: game.sessionDurationSec });
    });

    // host:triggerFinale {} -> transition to Write-In Finale after current cycle
    onValid(socket, 'host:triggerFinale', {}, (payload, reply) => {
      game.triggerFinale();
      io.to(roomChannel(game.roomCode)).emit('session:finaleTriggered', { cycle: game.cycle });
      reply({ ok: true });
    });

    // host:config { debateSeconds?: 105 | 165, showForecastBeforeVote?: boolean }
    // -> teacher settings, lobby only. The ack carries the full config;
    // everyone in the room gets host:config.
    onValid(socket, 'host:config', { debateSeconds: 'number?', showForecastBeforeVote: 'boolean?' }, (payload, reply) => {
      const result = game.configure(payload);
      if (result.ok) io.to(roomChannel(game.roomCode)).emit('host:config', result.config);
      return reply(result);
    });

    // host:playAgain { keepPlayers? } -> reset this room for the next game
    // (next class period) without restarting Node. Unless keepPlayers, every
    // phone is released from its seat and must join again.
    onValid(socket, 'host:playAgain', { keepPlayers: 'boolean?' }, (payload, reply) => {
      const keepPlayers = payload.keepPlayers === true;
      if (!keepPlayers) {
        // Local adapter: the room's sockets are in this process.
        const ids = io.sockets.adapter.rooms.get(roomChannel(game.roomCode)) || new Set();
        for (const id of Array.from(ids)) {
          const s = io.sockets.sockets.get(id);
          if (!s || !s.data.node) continue;
          s.emit('session:invalid', { reason: 'ROOM_RESET' });
          s.data.node = null;
          s.data.roomCode = null;
          s.leave(roomChannel(game.roomCode));
        }
      }
      const result = game.playAgain({ keepPlayers });
      broadcastLobby(game);
      return reply(result);
    });

    // host:skipIntro {} -> cut the 30 s intro crawl short (repeat classes).
    onValid(socket, 'host:skipIntro', {}, (payload, reply) => {
      if (game.phase !== 'INTRO') return reply({ ok: false, reason: 'NOT_IN_INTRO' });
      game.advancePhase();
      return reply({ ok: true, phase: game.phase });
    });

    // host:narrated { phase, cycle } -> the Loom finished reading INTRO or a
    // crisis (INCIDENT) aloud on the projector: move on after a short beat.
    onValid(socket, 'host:narrated', { phase: 'string', cycle: 'number?' }, (payload, reply) => {
      const res = game.narrationDone(payload.phase, payload.cycle);
      return reply(res);
    });

    // host:start { seed? } -> begin the phase flow once all 5 nodes have
    // joined. `seed` (a past game:end seed) replays that game's runs exactly.
    onValid(socket, 'host:start', { seed: 'string?' }, (payload, reply) => {
      if (payload.seed !== undefined && !gameEngine.isValidSeed(payload.seed)) return reply({ ok: false, reason: 'BAD_SEED' });
      const joined = Object.keys(game.players).length;
      const humanCount = Object.values(game.players).filter((p) => !p.isBot).length;
      if (joined < gameEngine.MAX_PLAYERS || (game.botsEnabled && humanCount < 1)) {
        const reason = (game.botsEnabled && humanCount < 1) ? 'NEED_ONE_HUMAN' : 'NOT_ENOUGH_PLAYERS';
        socket.emit('host:error', { reason, joined, humanCount });
        return reply({ ok: false, reason, joined });
      }
      if (game.phase !== 'LOBBY') return reply({ ok: false, reason: 'ALREADY_STARTED' });
      if (payload.seed !== undefined) game.setSeed(payload.seed);
      if (!game.startIntroPhase()) return reply({ ok: false, reason: 'ALREADY_STARTED' });
      return reply({ ok: true, seed: game.gameId });
    });
  }

  // Room a phone targets: the code it sent, else the classroom's latest room.
  function findPhoneRoom(code) {
    if (demoRoom()) return gameEngine.getRoom(demoRoom());
    return code ? gameEngine.getRoom(code) : gameEngine.getLatestRoom();
  }

  // Rebind a phone to its seat using its private token. Returns true on success.
  function resumeSession(socket, token) {
    const session = gameEngine.findSession(token);
    if (!session) return false;
    bindPhone(socket, session.game, session.node);
    return true;
  }

  // Bind this socket to an existing seat (new socket.id -> NODE-0X) and
  // tell the phone where the game is.
  function bindPhone(socket, game, node) {
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
      role: role ? roleCard(role) : null,
      // Persistent world (set at the Cycle 2 reveal) so a rejoining phone re-themes.
      world: game.worldKey ? game.worldInfo() : null
    });
    broadcastLobby(game);
    syncPhone(socket, game, node);
  }

  // state:sync: replay this node's private state to its new socket
  // (role, current phase, this cycle's intel, Override status, revise
  // feedback, finale ballot, game:end), shaped exactly like the live events.
  function syncPhone(socket, game, node) {
    for (const [event, payload] of game.privateSyncFor(node)) {
      if (event === 'role:assigned') socket.emit(event, { role: roleCard(payload.role) });
      else if (event === 'override:status') socket.emit(event, { overrideAvailable: !!payload.overrideAvailable });
      else if (event === 'game:end') socket.emit(event, gameEndPayload(payload));
      else socket.emit(event, payload);
    }
  }

  // Spectators (e.g. a 6th student in a larger group): read-only. They get
  // the same public broadcasts as the projector's room channel (phase,
  // resolution, world:reveal, lobby:update, progress, game:end) and nothing
  // private: no seat, no role, no intel, no ballot, and no actions.
  function addSpectator(socket, game) {
    wireRoom(game);
    socket.data.roomCode = game.roomCode;
    socket.data.spectator = true;
    socket.join(roomChannel(game.roomCode));
    socket.emit('spectate:joined', { roomCode: game.roomCode, phase: game.phase, cycle: game.cycle });
    if (game.worldKey) socket.emit('world:reveal', game.worldInfo());
    for (const [event, payload] of game.hostSync()) {
      socket.emit(event, event === 'game:end' ? gameEndPayload(payload) : payload);
    }
  }

  function handleSpectator(socket) {
    socket.emit('client:type', { clientType: 'spectator' });
    const hs = socket.handshake || {};
    const code = (hs.auth && hs.auth.roomCode) || (hs.query && hs.query.roomCode);
    const game = findPhoneRoom(code);
    if (!game) {
      socket.emit('spectate:error', { reason: 'NO_ROOM' });
      return;
    }
    addSpectator(socket, game);
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
    // Mid-game, a phone that lost its token may reclaim its own offline seat
    // by the same name (and its saved node id, if it still has it).
    onValid(socket, 'lobby:join', { name: nonEmptyString, room: 'string?', node: 'string?' }, (payload, reply) => {
      if (socket.data.node) return reply({ ok: false, reason: 'ALREADY_JOINED' });
      const game = findPhoneRoom(payload.room);
      if (!game) return reply({ ok: false, reason: 'NO_ROOM' });
      if (game.phase !== 'LOBBY') {
        const node = game.findReconnectSeat({ name: payload.name, node: payload.node });
        if (!node) return reply(joinRefusal('GAME_IN_PROGRESS'));
        bindPhone(socket, game, node);
        const rejoined = { ok: true, node, roomCode: game.roomCode, token: game.players[node].token, resumed: true };
        socket.emit('lobby:joined', rejoined);
        return reply(rejoined);
      }

      const seat = game.addPlayer(socket.id, payload.name);
      if (!seat.ok) return reply(joinRefusal(seat.reason));

      wireRoom(game);
      socket.data.roomCode = game.roomCode;
      socket.data.node = seat.node;
      socket.join(roomChannel(game.roomCode));
      const joined = { ok: true, node: seat.node, roomCode: game.roomCode, token: seat.token };
      socket.emit('lobby:joined', joined);
      reply(joined);
      return broadcastLobby(game);
    });

    // spectate:join { room? } -> a phone that could not take a seat watches
    // read-only instead (it can still lobby:join the next game in LOBBY).
    onValid(socket, 'spectate:join', { room: 'string?' }, (payload, reply) => {
      if (socket.data.node) return reply({ ok: false, reason: 'ALREADY_JOINED' });
      const game = findPhoneRoom(payload.room);
      if (!game) return reply({ ok: false, reason: 'NO_ROOM' });
      addSpectator(socket, game);
      return reply({ ok: true, roomCode: game.roomCode, phase: game.phase });
    });

    // vote:cast { choice: 'A' | 'B', override: bool } -> record a blind vote.
    const voteSchema = { choice: (v) => v === 'A' || v === 'B', override: 'boolean?' };
    onValid(socket, 'vote:cast', voteSchema, (payload, reply) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node) return reply({ ok: false, reason: 'NOT_JOINED' });
      // Duplicate vote from the same node this cycle: ignore it (no progress
      // broadcast, no early advance); the first vote stands.
      if (game.votes[socket.data.node]) return reply({ ok: false, reason: 'ALREADY_VOTED' });
      const result = game.castVote(socket.data.node, payload.choice, payload.override === true);
      reply(result);
      // vote:progress { voted: [node] } -> who has locked in (never their choice).
      if (result.ok) io.to(roomChannel(game.roomCode)).emit('vote:progress', { voted: Object.keys(game.votes) });
      // Early advance: end VOTE as soon as all 5 nodes have voted.
      if (result.ok && game.phase === 'VOTE' && game.allVotesIn()) game.advancePhase();
      return undefined;
    });

    // finale:submit { text } -> this phone's write-in during FINALE_WRITE, or its
    // single resubmission during the FINALE_MOD revise window.
    onValid(socket, 'finale:submit', FINALE_SCHEMAS.submit, (payload, reply) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node) return reply({ ok: false, reason: 'NOT_JOINED' });
      // During FINALE_MOD the same event is the one resubmission for a "revise".
      const result = game.phase === 'FINALE_MOD'
        ? game.resubmitPolicy(socket.data.node, payload.text)
        : game.submitPolicy(socket.data.node, payload.text);
      reply(result);
      // finale:progress { submitted: [node] } -> who has written (never what).
      if (result.ok) io.to(roomChannel(game.roomCode)).emit('finale:progress', { submitted: game.submittedNodes() });
      return undefined;
    });

    // finale:rank { order: [id, id, id, id] } -> this phone's Borda ballot.
    onValid(socket, 'finale:rank', FINALE_SCHEMAS.rank, (payload, reply) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node) return reply({ ok: false, reason: 'NOT_JOINED' });
      const result = game.rankPolicies(socket.data.node, payload.order);
      reply(result);
      // finale:progress { ranked: [node] } -> who has ranked (never how).
      if (result.ok) io.to(roomChannel(game.roomCode)).emit('finale:progress', { ranked: game.rankedNodes() });
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

    // debate:ready { ready? } -> signal readiness to vote early and skip the remainder of DEBATE
    onValid(socket, 'debate:ready', { ready: 'boolean?' }, (payload, reply) => {
      const game = gameEngine.getRoom(socket.data.roomCode);
      if (!game || !socket.data.node) return reply({ ok: false, reason: 'NOT_JOINED' });
      const result = game.setDebateReady(socket.data.node, payload.ready !== false);
      reply(result);
      if (result.ok) {
        io.to(roomChannel(game.roomCode)).emit('debate:progress', {
          ready: result.ready,
          count: result.count,
          total: result.total
        });
        if (result.allReady && game.phase === 'DEBATE') {
          game.advancePhase();
        }
      }
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
    else if (clientType === 'spectator') handleSpectator(socket);
    else handlePhone(socket);
  });

  return io;
}

module.exports = { initSockets, joinRefusal, JOIN_REFUSALS, detectClientType, roomChannel, hostChannel, roleCard, gameEndPayload, GAME_END_KEYS, isValidPayload, allowEvent, RATE_BURST, RATE_PER_SECOND, FINALE_SCHEMAS };
