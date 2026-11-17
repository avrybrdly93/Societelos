'use strict';

// End-to-end: a real Socket.IO server, one host and 5 phone clients play
// Cycles 1-4 (with the world reveal) on shrunken FAST_TIMERS.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '0.02';
delete process.env.GEMINI_API_KEY; // offline Loom fallback

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

test('5 simulated phones play Cycles 1-4 over Socket.IO', { timeout: 20000 }, async () => {
  const log = console.log;
  console.log = () => {};
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const connect = (auth) => {
    const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };

  try {
    const host = connect({ clientType: 'host' });
    const { roomCode } = await once(host, 'host:room');
    engine.getRoom(roomCode).gameId = 'socketflow01'; // fixed seeds: reproducible run

    const phones = [];
    const privateEvents = { roles: 0, intel: 0, loom: 0, override: 0, score: 0 };
    for (let i = 0; i < 5; i++) {
      const phone = connect({ clientType: 'phone' });
      await once(phone, 'connect');
      const joined = await phone.emitWithAck('lobby:join', { name: `Student ${i + 1}`, room: roomCode });
      assert.ok(joined.ok, joined.reason);
      await phone.emitWithAck('lobby:ready', { ready: true });
      phone.on('role:assigned', () => privateEvents.roles++);
      phone.on('intel:drop', () => privateEvents.intel++);
      phone.on('loom:line', () => privateEvents.loom++);
      phone.on('override:status', () => privateEvents.override++);
      phone.on('score:update', () => privateEvents.score++);
      // Cycle 1: A wins 3-2; cycle 2: B wins -> world AB; cycles 3-4: A wins.
      phone.on('phase', (p) => {
        if (p.phase !== 'VOTE') return;
        const choice = p.cycle === 2 ? 'B' : i < 3 ? 'A' : 'B';
        phone.emit('vote:cast', { choice, override: false });
      });
      phones.push(phone);
    }

    const hostPhases = [];
    const resolutions = [];
    let reveal = null;
    host.on('phase', (p) => hostPhases.push(`${p.cycle}:${p.phase}`));
    host.on('resolution', (r) => resolutions.push(r));
    host.on('world:reveal', (w) => { reveal = w; });

    const reachedCycle5 = new Promise((resolve) => {
      host.on('phase', (p) => { if (p.cycle === 5 || p.phase === 'END') resolve(); });
    });
    const started = await host.emitWithAck('host:start', {});
    assert.ok(started.ok, started.reason);
    await reachedCycle5;

    assert.equal(resolutions.length, 4);
    assert.deepEqual(resolutions.map((r) => r.result.winner), ['A', 'B', 'A', 'A']);
    assert.deepEqual(reveal && reveal.worldKey, 'AB');
    assert.ok(hostPhases.includes('2:WORLD_REVEAL'));
    assert.equal(privateEvents.roles, 5);
    assert.equal(privateEvents.intel, 0, 'intel drops are gone');
    assert.ok(privateEvents.loom >= 5 * 4 * 2, 'every phone hears the Loom each cycle');
    assert.equal(privateEvents.override, 20);
    assert.equal(privateEvents.score, 20, 'private score update per phone per cycle');
    const game = engine.getRoom(roomCode);
    assert.equal(game.worldKey, 'AB');
    assert.equal(game.cycle, 5);
  } finally {
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});

test('Dev Mode: 1 human player and 4 bots automatically fill and vote', { timeout: 15000 }, async () => {
  const log = console.log;
  console.log = () => {};
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const connect = (auth) => {
    const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };

  try {
    const host = connect({ clientType: 'host' });
    const { roomCode } = await once(host, 'host:room');
    const game = engine.getRoom(roomCode);

    // Enable dev mode bots
    const toggleRes = await host.emitWithAck('host:toggleBots', { enabled: true });
    assert.ok(toggleRes.ok);
    assert.equal(toggleRes.botsEnabled, true);

    // 1 human joins
    const phone = connect({ clientType: 'phone' });
    await once(phone, 'connect');
    const joined = await phone.emitWithAck('lobby:join', { name: 'Solo Dev', room: roomCode });
    assert.ok(joined.ok);
    assert.equal(joined.node, 'NODE-01');

    // Verify 1 human + 4 bots in game
    assert.equal(Object.keys(game.players).length, 5);
    assert.equal(game.players['NODE-01'].isBot, false);
    for (let i = 2; i <= 5; i++) {
      assert.equal(game.players[`NODE-0${i}`].isBot, true);
    }

    // Host starts session
    const startRes = await host.emitWithAck('host:start', {});
    assert.ok(startRes.ok);

    // Listen for vote phase: human votes A, bots vote automatically
    phone.on('phase', (p) => {
      if (p.phase === 'VOTE') {
        phone.emit('vote:cast', { choice: 'A' });
      }
    });

    // Wait for resolution
    const res = await once(host, 'resolution');
    assert.ok(res);
    assert.ok(res.result);
    // All 5 votes were cast (1 human + 4 bots)
    assert.equal(Object.keys(game.votes).length, 5);
  } finally {
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});

test('Ready to Vote: debate:ready skips remainder of debate phase early', { timeout: 15000 }, async () => {
  const log = console.log;
  console.log = () => {};
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const connect = (auth) => {
    const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };

  try {
    const host = connect({ clientType: 'host' });
    const { roomCode } = await once(host, 'host:room');
    const game = engine.getRoom(roomCode);
    await host.emitWithAck('host:toggleBots', { enabled: true });

    const phone = connect({ clientType: 'phone' });
    await once(phone, 'connect');
    await phone.emitWithAck('lobby:join', { name: 'Dev Tester', room: roomCode });
    await host.emitWithAck('host:start', {});

    // Listen for debate phase
    const enteredDebate = new Promise((resolve) => {
      phone.on('phase', (p) => { if (p.phase === 'DEBATE') resolve(); });
    });
    await enteredDebate;
    assert.equal(game.phase, 'DEBATE');

    // Human signals ready to vote
    const readyRes = await phone.emitWithAck('debate:ready', { ready: true });
    assert.ok(readyRes.ok);
    assert.ok(readyRes.allReady);

    // Verify it transitioned to VOTE
    assert.equal(game.phase, 'VOTE');
  } finally {
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});

test('Blitz Session Mode: plays multiple policies and transitions to Write-In Finale', { timeout: 15000 }, async () => {
  const log = console.log;
  console.log = () => {};
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const connect = (auth) => {
    const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };

  try {
    const host = connect({ clientType: 'host' });
    const { roomCode } = await once(host, 'host:room');
    const game = engine.getRoom(roomCode);
    await host.emitWithAck('host:toggleBots', { enabled: true });
    // Configure session mode with 1 second duration
    await host.emitWithAck('host:configureSession', { enabled: true, durationSec: 1 });
    assert.strictEqual(game.sessionTimerEnabled, true);

    const phone = connect({ clientType: 'phone' });
    await once(phone, 'connect');
    await phone.emitWithAck('lobby:join', { name: 'Blitz Player', room: roomCode });
    await host.emitWithAck('host:start', {});

    // Collect phases encountered
    const phases = [];
    let sawFinale = false;
    const reachedEnd = new Promise((resolve) => {
      host.on('phase', (p) => {
        phases.push(p.phase);
        if (p.phase === 'FINALE_WRITE' || p.phase === 'FINALE_RANK') sawFinale = true;
        if (p.phase === 'END') resolve();
      });
    });

    // Auto-vote on phone when vote opens
    phone.on('phase', async (p) => {
      if (p.phase === 'VOTE') {
        await phone.emitWithAck('vote:cast', { choice: 'A' }).catch(() => {});
      } else if (p.phase === 'FINALE_WRITE') {
        await phone.emitWithAck('finale:submit', { text: 'Ensure equal energy for all districts.' }).catch(() => {});
      } else if (p.phase === 'FINALE_RANK') {
        const ballot = await once(phone, 'finale:ballot');
        const ids = ballot.policies.map((x) => x.id);
        await phone.emitWithAck('finale:rank', { order: ids }).catch(() => {});
      }
    });

    await reachedEnd;
    assert.ok(sawFinale, 'Should transition through write-in finale');
    assert.strictEqual(game.phase, 'END');
  } finally {
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});
