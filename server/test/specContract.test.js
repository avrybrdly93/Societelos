'use strict';

// TASK-625: the backend's HTTP endpoints and Socket.IO events match the MVP
// spec ("Socket events" table in mvp_spec.md), checked over a real server
// through a whole 5-cycle game with a host and 5 phones.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '0.02';
delete process.env.GEMINI_API_KEY;

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');
const loom = require('../loom');
const { okModeration } = require('./playGame');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
let flowSeen = null; // events recorded by the full-game test, reused by TASK-647

/** The spec table, parsed from mvp_spec.md so the test follows the document. */
function specTable() {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'mvp_spec.md'), 'utf8');
  const section = md.slice(md.indexOf('### Socket events'));
  const rows = [];
  for (const line of section.split('\n').slice(1)) {
    const m = line.match(/^\| `([a-z:]+)` \| (.+?) \| `(.+)`/);
    if (m) rows.push({ event: m[1], direction: m[2].trim(), payload: m[3] });
    else if (rows.length && !line.startsWith('|')) break;
  }
  return rows;
}

/** Top-level keys named in a spec payload like `{ result, gdw, crisis? }`. */
function specKeys(payload) {
  const inner = payload.replace(/^\{\s*|\s*\}$/g, '');
  let depth = 0;
  let cur = '';
  const parts = [];
  for (const ch of inner) {
    if ('[{'.includes(ch)) depth++;
    if (']}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().match(/^([a-zA-Z]+)(\?)?/)).filter(Boolean).map((m) => ({ key: m[1], optional: !!m[2] }));
}

test('the spec table lists the 14 socket events', () => {
  const rows = specTable();
  assert.equal(rows.length, 14);
  assert.deepEqual(specKeys('{ cycle, phase, endsAt, crisis? }'), [
    { key: 'cycle', optional: false }, { key: 'phase', optional: false }, { key: 'endsAt', optional: false }, { key: 'crisis', optional: true }
  ]);
});

test('HTTP endpoints: /, /host, /mobile, /health and /api/qr respond as documented', async () => {
  const log = console.log;
  console.log = () => {};
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/host', '/mobile']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200, route);
      assert.match(res.headers.get('content-type'), /text\/html/, route);
    }
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(typeof health.activeRooms, 'number');
    const qr = await (await fetch(`${base}/api/qr`)).json();
    assert.match(qr.joinUrl, /^http:\/\/[^/]+:\d+\/mobile$/);
    assert.match(qr.dataUrl, /^data:image\/png;base64,/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});

test('every spec socket event flows over a full game with the spec payload keys', { timeout: 30000 }, async () => {
  const log = console.log;
  console.log = () => {};
  const realModerate = loom.moderate;
  // One write-in comes back "revise" so finale:feedback is exercised too.
  loom.moderate = async (subs) => okModeration(subs).map((r, i) => (i === 4
    ? { node: r.node, status: 'revise', cleaned: '', feedback: 'Keep it about policy.', roles: [], effects: {} }
    : r));
  const realModerateOne = loom.moderateOne;
  loom.moderateOne = async (sub) => ({ node: sub.node, status: 'ok', cleaned: sub.text, feedback: '', roles: ['ghost'], effects: { trust: 0.2 } });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const connect = (auth) => {
    const s = ioClient(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };
  const seen = { host: {}, phone: {} };
  const record = (who, event, payload) => { (seen[who][event] = seen[who][event] || []).push(payload); };
  const acks = {};
  try {
    const host = connect({ clientType: 'host' });
    const { roomCode } = await once(host, 'host:room');
    engine.getRoom(roomCode).gameId = 'speccontract';
    host.onAny((event, payload) => record('host', event, payload));
    const phones = [];
    for (let i = 0; i < 5; i++) {
      const phone = connect({ clientType: 'phone' });
      await once(phone, 'connect');
      phone.onAny((event, payload) => record('phone', event, payload));
      const joined = await phone.emitWithAck('lobby:join', { name: `Spec ${i + 1}` });
      assert.ok(joined.ok, joined.reason);
      await phone.emitWithAck('lobby:ready', { ready: true });
      phone.on('phase', async (p) => {
        if (p.phase === 'VOTE') acks['vote:cast'] = await phone.emitWithAck('vote:cast', { choice: p.cycle <= 2 ? 'B' : 'A', override: false });
        if (p.phase === 'FINALE_WRITE') acks['finale:submit'] = await phone.emitWithAck('finale:submit', { text: `Spec policy ${i + 1}` });
      });
      phone.on('finale:feedback', async (f) => {
        if (f.status === 'revise') acks.resubmit = await phone.emitWithAck('finale:submit', { text: 'A clean revised policy.' });
      });
      phone.on('finale:ballot', async (b) => {
        acks['finale:rank'] = await phone.emitWithAck('finale:rank', { order: b.policies.map((x) => x.id) });
      });
      phones.push(phone);
    }
    const ended = once(host, 'game:end');
    acks['host:start'] = await host.emitWithAck('host:start', {});
    await ended;
    await new Promise((r) => setTimeout(r, 50));

    for (const name of ['host:start', 'vote:cast', 'finale:submit', 'finale:rank', 'resubmit']) {
      assert.equal(acks[name] && acks[name].ok, true, `${name} accepted`);
    }
    for (const { event, direction, payload } of specTable()) {
      if (direction.endsWith('→ server')) continue; // inbound: checked by the acks above (and lobby:join)
      const toAll = direction.includes('all');
      const who = toAll ? 'host' : 'phone';
      const got = seen[who][event];
      assert.ok(got && got.length, `${event} received by ${who}`);
      for (const { key, optional } of specKeys(payload)) {
        if (optional) continue;
        assert.ok(got.some((p) => p && key in p), `${event} payload has "${key}"`);
      }
      if (!toAll) assert.equal(seen.host[event], undefined, `${event} is private: never sent to the projector`);
    }
    flowSeen = seen;
    // Shapes the spec spells out.
    assert.ok(seen.phone['finale:ballot'].every((b) => b.policies.length === 4), 'ballot: the other four');
    assert.ok(seen.host['lobby:update'].every((u) => u.players.every((p) => 'node' in p && 'ready' in p && !('name' in p))), 'lobby:update has no names');
  } finally {
    loom.moderate = realModerate;
    loom.moderateOne = realModerateOne;
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    console.log = log;
  }
});

// TASK-646 ------------------------------------------------------------------

/** Levenshtein distance, for spotting near-miss event names. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

test('all 14 spec event names appear character-for-character in the server, with no near-miss spellings anywhere', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  const socketSrc = read('server/socket.js');
  const engineSrc = read('server/gameEngine.js');
  const clientSrc = ['public/js/host.js', 'public/js/mobile.js'].map(read).join('\n');
  const rows = specTable();
  assert.equal(rows.length, 14);
  for (const { event, direction } of rows) {
    if (direction.endsWith('→ server')) {
      assert.ok(socketSrc.includes(`onValid(socket, '${event}'`), `server listens for '${event}' (validated)`);
    } else {
      // Emitted by socket.js, directly or relaying the engine event of the same name.
      assert.ok(new RegExp(`(\\.emit\\(|emitToNode\\([^,]+,[^,]+, )'${event}'`).test(socketSrc), `server emits '${event}'`);
    }
  }
  // Every event-looking string in server and clients: either a spec name, an
  // intentional extra event, or clearly different (not a typo of a spec name).
  const INTENTIONAL = new Set(['lobby:joined', 'lobby:ready']);
  const names = new Set(rows.map((r) => r.event));
  const used = new Set([...`${socketSrc}\n${engineSrc}\n${clientSrc}`.matchAll(/'([a-z]+:[a-zA-Z]+)'/g)].map((m) => m[1]));
  for (const name of used) {
    if (names.has(name) || INTENTIONAL.has(name)) continue;
    for (const spec of names) {
      assert.ok(distance(name, spec) > 2, `'${name}' looks like a misspelling of spec event '${spec}'`);
    }
  }
});

// TASK-647 ------------------------------------------------------------------

test('payload keys for all 14 events match the spec table character-for-character', () => {
  assert.ok(flowSeen, 'the full-game test ran first');
  const rows = specTable();
  // Outbound: every payload of the event carries every required spec key, spelled exactly.
  for (const { event, direction, payload } of rows) {
    if (direction.endsWith('→ server')) continue;
    const got = flowSeen[direction.includes('all') ? 'host' : 'phone'][event];
    for (const { key, optional } of specKeys(payload)) {
      if (optional) continue;
      got.forEach((p, i) => assert.ok(Object.prototype.hasOwnProperty.call(p, key), `${event} #${i} has "${key}"`));
    }
  }
  // Nested shapes named in the table.
  for (const u of flowSeen.host['lobby:update']) for (const pl of u.players) for (const k of ['node', 'ready']) assert.ok(k in pl, `lobby:update players[].${k}`);
  for (const b of flowSeen.phone['finale:ballot']) for (const pol of b.policies) assert.deepEqual(Object.keys(pol).sort(), ['id', 'text']);
  for (const v of flowSeen.phone['finale:feedback']) assert.ok(['ok', 'revise', 'reject'].includes(v.status));
  for (const p of flowSeen.host.phase) assert.ok(typeof p.cycle === 'number' && typeof p.phase === 'string' && 'endsAt' in p);

  // Inbound: what the real phone and projector clients send uses the spec keys.
  const clients = ['public/js/host.js', 'public/js/mobile.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')).join('\n');
  for (const { event, direction, payload } of rows) {
    if (!direction.endsWith('→ server')) continue;
    const keys = specKeys(payload).map((k) => k.key);
    if (!keys.length) {
      // e.g. host:start {}: any payload object will do (extras like seed are optional).
      assert.ok(clients.includes(`emit('${event}',`), `a client sends '${event}'`);
      continue;
    }
    const sends = [...clients.matchAll(new RegExp(`emit\\('${event}', \\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
    assert.ok(sends.length, `a client sends '${event}'`);
    for (const body of sends) {
      const sent = body.split(',').map((x) => x.trim().split(':')[0].trim()).filter(Boolean);
      for (const key of keys) assert.ok(sent.includes(key), `client '${event}' sends "${key}" (sent: ${sent.join(', ') || 'nothing'})`);
    }
  }
});
