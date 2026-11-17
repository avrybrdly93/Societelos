'use strict';

// Stress: many full games, one after another, on one server instance and
// one room (the teacher's laptop across a school day), reset with
// host:playAgain between games.

const test = require('node:test');
const assert = require('node:assert/strict');

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

test('10 sequential full games on the same server instance', { timeout: 120000 }, async () => {
  const log = console.log;
  console.log = () => {};
  const realModerate = loom.moderate;
  loom.moderate = async (subs) => okModeration(subs);
  const room = await classroom();
  try {
    const listeners = room.game.listenerCount('phase');
    const seeds = [];
    for (let g = 1; g <= 10; g++) {
      const end = await room.playOne(g);
      seeds.push(end.seed);
      assert.equal(end.cyclesPlayed >= 1, true);
      assert.ok(['SHUTDOWN', 'Fragile', 'Stable', 'Thriving'].includes(end.grade), `game ${g} grade`);
      assert.equal(end.roles.length, 5);
      assert.equal(room.game.phase, 'LOBBY', `game ${g} reset to LOBBY`);
      assert.equal(engine.rooms.size, 1, 'still one room');
      assert.equal(Object.keys(room.game.players).length, 5);
      assert.equal(room.game.listenerCount('phase'), listeners, 'no listener build-up');
    }
    assert.equal(new Set(seeds).size, 10, 'ten distinct games');
  } finally {
    loom.moderate = realModerate;
    await room.close();
    console.log = log;
  }
});
