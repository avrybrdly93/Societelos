'use strict';

// Mid-game phone reconnection over a real Socket.IO server.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '0.5';
delete process.env.GEMINI_API_KEY;

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let url;
const clients = [];
const log = console.log;

test.before(async () => {
  console.log = () => {};
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const c of clients) c.close();
  for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
  io.close();
  await new Promise((resolve) => server.close(resolve));
  console.log = log;
});

function connect(auth) {
  const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(s);
  return s;
}

/** A room with 5 seated, ready phones and the game started. */
async function startedRoom() {
  for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
  const host = connect({ clientType: 'host' });
  const { roomCode } = await once(host, 'host:room');
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const phone = connect({ clientType: 'phone' });
    await once(phone, 'connect');
    const joined = await phone.emitWithAck('lobby:join', { name: `Student ${i + 1}`, room: roomCode });
    assert.ok(joined.ok, joined.reason);
    await phone.emitWithAck('lobby:ready', { ready: true });
    phones.push({ socket: phone, ...joined });
  }
  const started = await host.emitWithAck('host:start', {});
  assert.ok(started.ok, started.reason);
  return { host, roomCode, phones, game: engine.getRoom(roomCode) };
}

// TASK-609 ------------------------------------------------------------------

test('a phone that drops mid-game rebinds its new socket to the same NODE seat (token)', { timeout: 15000 }, async () => {
  const { roomCode, phones, game } = await startedRoom();
  const lost = phones[2];
  lost.socket.close();
  await until(() => game.players[lost.node].connected === false);

  const back = connect({ clientType: 'phone', token: lost.token });
  const resumed = await once(back, 'session:resumed');
  assert.equal(resumed.node, lost.node);
  assert.equal(resumed.roomCode, roomCode);
  assert.equal(game.players[lost.node].socketId, back.id);
  assert.equal(game.players[lost.node].connected, true);
  assert.equal(Object.keys(game.players).length, 5, 'no sixth seat');
});

test('without a token, the same name reclaims only its own offline seat', { timeout: 15000 }, async () => {
  const { roomCode, phones, game } = await startedRoom();
  const lost = phones[3];
  lost.socket.close();
  await until(() => game.players[lost.node].connected === false);

  // A live player's name cannot be used to steal their seat.
  const thief = connect({ clientType: 'phone' });
  await once(thief, 'connect');
  const stolen = await thief.emitWithAck('lobby:join', { name: 'Student 1', room: roomCode });
  assert.deepEqual(stolen, { ok: false, reason: 'GAME_IN_PROGRESS' });
  assert.notEqual(game.players['NODE-01'].socketId, thief.id);

  // The wrong saved node id with the right name is refused too.
  const wrong = await thief.emitWithAck('lobby:join', { name: 'Student 4', room: roomCode, node: 'NODE-01' });
  assert.equal(wrong.ok, false);

  // Same name (any case), no token: rebinds to NODE-04 and hands back the token.
  const back = connect({ clientType: 'phone' });
  await once(back, 'connect');
  const rejoined = await back.emitWithAck('lobby:join', { name: '  student 4 ', room: roomCode, node: lost.node });
  assert.equal(rejoined.ok, true);
  assert.equal(rejoined.resumed, true);
  assert.equal(rejoined.node, lost.node);
  assert.equal(rejoined.token, lost.token);
  assert.equal(game.players[lost.node].socketId, back.id);
  assert.equal(game.players[lost.node].connected, true);
});

// TASK-610 ------------------------------------------------------------------

const { playGame, okModeration, withLoom } = require('./playGame');

test('privateSyncFor replays role, phase, intel, Override, ballot and game:end for one node only', async () => {
  const snaps = {};
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    const out = await playGame({
      gameId: 'sync-phases',
      world: 'AA',
      onEvent: (type, ev, game) => {
        if (type !== 'phase') return;
        const key = `${ev.cycle}:${ev.phase}`;
        if (['1:VOTE', '5:FINALE_RANK', '5:END'].includes(key)) {
          setImmediate(() => { snaps[key] = game.privateSyncFor('NODE-02'); });
        }
      }
    });
    const events = (key) => snaps[key].map(([e]) => e);
    const payload = (key, name) => (snaps[key].find(([e]) => e === name) || [])[1];

    assert.deepEqual(events('1:VOTE'), ['state:sync', 'role:assigned', 'phase', 'intel:drop', 'override:status']);
    assert.equal(payload('1:VOTE', 'state:sync').node, 'NODE-02');
    assert.equal(payload('1:VOTE', 'role:assigned').role.key, out.roles['NODE-02']);
    assert.equal(payload('1:VOTE', 'phase').phase, 'VOTE');
    const drop = out.intel.find((d) => d.cycle === 1 && d.node === 'NODE-02');
    assert.equal(payload('1:VOTE', 'intel:drop').text, drop.text);
    assert.deepEqual(payload('1:VOTE', 'override:status'), { overrideAvailable: true });

    assert.deepEqual(events('5:FINALE_RANK'), ['state:sync', 'role:assigned', 'phase', 'finale:ballot']);
    const ballot = out.ballots.find((b) => b.node === 'NODE-02');
    assert.deepEqual(payload('5:FINALE_RANK', 'finale:ballot').policies, ballot.policies);

    assert.deepEqual(events('5:END'), ['state:sync', 'role:assigned', 'phase', 'game:end']);
    assert.equal(payload('5:END', 'game:end'), out.gameEnd);

    for (const snap of Object.values(snaps)) {
      for (const [, p] of snap) assert.ok(!('node' in p) || p.node === 'NODE-02', 'nothing addressed to another node');
    }
  });
});

test('a phone that reconnects mid-game receives state:sync, its role card and the current phase', { timeout: 15000 }, async () => {
  const { phones, game } = await startedRoom();
  await until(() => game.phase === 'CHAMBER' || game.cycle >= 1);
  const lost = phones[1];
  lost.socket.close();
  await until(() => game.players[lost.node].connected === false);

  const back = connect({ clientType: 'phone', token: lost.token });
  const got = {};
  for (const e of ['state:sync', 'role:assigned', 'phase', 'lobby:update']) back.once(e, (p) => { got[e] = p; });
  await once(back, 'session:resumed');
  await until(() => got['state:sync'] && got['role:assigned'] && got.phase && got['lobby:update']);
  assert.equal(got['state:sync'].node, lost.node);
  assert.equal(got['role:assigned'].role.key, game.roleAssignment[lost.node].key);
  assert.ok(got['role:assigned'].role.cardText, 'the full role card, as on first deal');
  assert.ok(got.phase.phase && got.phase.phase !== 'LOBBY');
  assert.equal(got['lobby:update'].players.find((p) => p.node === lost.node).connected, true);
});
