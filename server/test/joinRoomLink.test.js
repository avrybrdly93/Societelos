'use strict';

// A phone that scans the QR code joins the room on the projector, even when a
// newer room exists (a second host tab, a refresh), and the QR link carries it.

const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.GEMINI_API_KEY;

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
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

test('the QR link carries the room code', async () => {
  const res = await fetch(`${url}/api/qr?room=abcd`);
  const { joinUrl } = await res.json();
  assert.ok(joinUrl.endsWith('?room=ABCD'), joinUrl);
  const plain = await (await fetch(`${url}/api/qr`)).json();
  assert.ok(!plain.joinUrl.includes('room='));
});

test('a phone with a room code joins that room, not the newest one', async () => {
  const hostA = connect({ clientType: 'host' });
  const infoA = await once(hostA, 'host:room');
  const hostB = connect({ clientType: 'host' }); // a newer room, e.g. a second tab
  const infoB = await once(hostB, 'host:room');
  assert.notEqual(infoA.roomCode, infoB.roomCode);

  const lobbyA = once(hostA, 'lobby:update');
  const phone = connect({ clientType: 'phone' });
  await once(phone, 'client:type');
  const joined = await phone.emitWithAck('lobby:join', { name: 'Ada', room: infoA.roomCode });
  assert.equal(joined.ok, true);
  assert.equal(joined.roomCode, infoA.roomCode);
  const update = await lobbyA;
  assert.equal(update.players.length, 1, 'the projector that showed the QR sees the phone');
});
