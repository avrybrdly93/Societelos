'use strict';

// TASK-645: after host:playAgain the server's heap returns to its baseline
// (no per-game leak in rooms, timers, listeners, finale state or sockets).

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('v8');
const vm = require('vm');

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '0.005';
delete process.env.GEMINI_API_KEY;

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');
const loom = require('../loom');
const { okModeration } = require('./playGame');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

/** One server, one host, five phones; play(n) runs n full games back to back. */
async function classroom() {
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const connect = (auth) => {
    const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };
  const host = connect({ clientType: 'host' });
  const { roomCode } = await once(host, 'host:room');
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const phone = connect({ clientType: 'phone' });
    await once(phone, 'connect');
    const joined = await phone.emitWithAck('lobby:join', { name: `Stress ${i}`, room: roomCode });
    assert.ok(joined.ok, joined.reason);
    phone.on('phase', (p) => {
      if (p.phase === 'VOTE') phone.emit('vote:cast', { choice: (p.cycle + i) % 3 ? 'A' : 'B' });
      if (p.phase === 'FINALE_WRITE') phone.emit('finale:submit', { text: `Stress policy ${i}` });
    });
    phone.on('finale:ballot', (b) => phone.emit('finale:rank', { order: b.policies.map((x) => x.id) }));
    phones.push(phone);
  }
  const game = engine.getRoom(roomCode);
  async function playOne(index) {
    for (const p of phones) await p.emitWithAck('lobby:ready', { ready: true });
    const ended = once(host, 'game:end');
    const started = await host.emitWithAck('host:start', { seed: `stress-${index}` });
    assert.ok(started.ok, `game ${index}: ${started.reason}`);
    const end = await ended;
    const again = await host.emitWithAck('host:playAgain', { keepPlayers: true });
    assert.ok(again.ok);
    return end;
  }
  async function close() {
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
  }
  return { game, playOne, close, roomCode };
}

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const heapMB = async () => {
  for (let i = 0; i < 3; i++) { gc(); await new Promise((r) => setImmediate(r)); }
  return process.memoryUsage().heapUsed / 1048576;
};

test('heap returns to baseline after host:playAgain across 12 games', { timeout: 180000 }, async () => {
  const log = console.log;
  console.log = () => {};
  const realModerate = loom.moderate;
  loom.moderate = async (subs) => okModeration(subs);
  const room = await classroom();
  try {
    // Warm-up: JIT, module caches, socket buffers.
    await room.playOne(1);
    await room.playOne(2);
    const baseline = await heapMB();
    const samples = [];
    for (let g = 3; g <= 12; g++) {
      await room.playOne(g);
      samples.push(await heapMB());
    }
    const growth = samples[samples.length - 1] - baseline;
    const label = `baseline ${baseline.toFixed(1)} MB; after each reset: ${samples.map((m) => m.toFixed(1)).join(', ')}`;
    assert.ok(growth < 3, `heap grew ${growth.toFixed(2)} MB over 10 games (${label})`);
    // Per-game state really is gone after the reset.
    assert.equal(room.game.finale, null);
    assert.equal(room.game.endData, null);
    assert.deepEqual(room.game.gdwHistory, []);
    assert.equal(room.game.phaseTimer, null);
  } finally {
    loom.moderate = realModerate;
    await room.close();
    console.log = log;
  }
});
