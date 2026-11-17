'use strict';

// TASK-608: game:end is broadcast over Socket.IO to the host and every phone.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '0.02';
delete process.env.GEMINI_API_KEY;

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');
const { gameEndPayload } = require('../socket');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const SPEC_KEYS = ['gdwHistory', 'finalGdw', 'grade', 'worldKey', 'worldName', 'closingMessage', 'roles', 'authors', 'scores', 'winner', 'shutdown', 'seed'];

test('game:end reaches the host and all 5 phones with the spec payload keys', { timeout: 20000 }, async () => {
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
    game.gameId = 'gameendsocket';
    const phones = [];
    for (let i = 0; i < 5; i++) {
      const phone = connect({ clientType: 'phone' });
      await once(phone, 'connect');
      const joined = await phone.emitWithAck('lobby:join', { name: `Student ${i + 1}`, room: roomCode });
      assert.ok(joined.ok, joined.reason);
      await phone.emitWithAck('lobby:ready', { ready: true });
      phones.push(phone);
    }
    const ends = [once(host, 'game:end'), ...phones.map((p) => once(p, 'game:end'))];
    // Start, then cut straight to END after role assignment (a shutdown-style end).
    host.on('phase', (p) => {
      if (p.phase === 'CHAMBER') { game.clearPhaseTimer(); game.startEndPhase(); }
    });
    const started = await host.emitWithAck('host:start', {});
    assert.ok(started.ok, started.reason);
    const payloads = await Promise.all(ends);
    for (const payload of payloads) {
      for (const key of SPEC_KEYS) assert.ok(key in payload, `game:end has ${key}`);
      assert.equal(payload.seed, 'gameendsocket');
      assert.equal(payload.roles.length, 5);
      assert.deepEqual(payload, payloads[0], 'everyone gets the same payload');
    }
  } finally {
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});

test('gameEndPayload keeps the spec keys and drops anything unlisted', () => {
  const out = gameEndPayload({ finalGdw: 40, grade: 'Stable', secretVector: { trust: 1 }, seed: 'abc' });
  assert.deepEqual(out, { finalGdw: 40, grade: 'Stable', seed: 'abc' });
});
