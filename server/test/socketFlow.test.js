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
    const privateEvents = { roles: 0, intel: 0, override: 0, score: 0 };
    for (let i = 0; i < 5; i++) {
      const phone = connect({ clientType: 'phone' });
      await once(phone, 'connect');
      const joined = await phone.emitWithAck('lobby:join', { name: `Student ${i + 1}`, room: roomCode });
      assert.ok(joined.ok, joined.reason);
      await phone.emitWithAck('lobby:ready', { ready: true });
      phone.on('role:assigned', () => privateEvents.roles++);
      phone.on('intel:drop', () => privateEvents.intel++);
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
    assert.equal(privateEvents.intel, 20, '5 phones x 4 cycles');
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
