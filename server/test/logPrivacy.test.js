'use strict';

// TASK-631: server logs only ever show NODE-01..NODE-05, never a student's
// name or write-in, across a whole game over Socket.IO (including a
// reconnect, a revise and prompt debugging with LOOM_PRIVACY on).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '0.02';
delete process.env.GEMINI_API_KEY;

const { io: ioClient } = require('socket.io-client');
const { server, io } = require('../server');
const engine = require('../gameEngine');
const loom = require('../loom');

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const NAMES = ['Quillon Varga', 'Ottilie Brandt', 'Rasmus Okafor', 'Ysolde Pemberton', 'Thaddeus Nakamura'];
const WRITE_INS = NAMES.map((n, i) => `Proposal ${i + 1} from ${n.split(' ')[0]}: zygomorphic tidal guilds`);

test('server logs carry node ids only: no student names or write-ins', { timeout: 30000 }, async () => {
  const lines = [];
  const capture = (...args) => lines.push(args.map(String).join(' '));
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = capture; console.error = capture; console.warn = capture; console.info = capture;
  const env = { LOG_PHASES: process.env.LOG_PHASES, LOOM_DEBUG_PROMPTS: process.env.LOOM_DEBUG_PROMPTS, LOOM_PRIVACY: process.env.LOOM_PRIVACY };
  process.env.LOG_PHASES = 'true';
  process.env.LOOM_DEBUG_PROMPTS = 'true';
  process.env.LOOM_PRIVACY = 'true';
  // Real loom.moderate with a fake Gemini, so its own logging path runs.
  const realModerate = loom.moderate;
  const config = { apiKey: 'test-key-not-real', enabled: true, model: 'gemini-2.5-flash', timeoutMs: 8000 };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const list = JSON.parse(body.contents[0].parts[0].text.split('\n\n').pop());
    const out = list.map((s) => ({ node: s.node, status: 'ok', cleaned: 'A tidy policy sentence.', feedback: '', roles: ['artisan'], effects: { purpose: 0.1, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 } }));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }], usageMetadata: { totalTokenCount: 10 } }) };
  };
  loom.moderate = (subs, crisis, opts = {}) => realModerate(subs, crisis, { ...opts, config, fetchImpl });

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
    const tokens = [];
    for (let i = 0; i < 5; i++) {
      const phone = connect({ clientType: 'phone' });
      await once(phone, 'connect');
      const joined = await phone.emitWithAck('lobby:join', { name: NAMES[i], room: roomCode });
      tokens.push(joined.token);
      await phone.emitWithAck('lobby:ready', { ready: true });
      phone.on('phase', (p) => {
        if (p.phase === 'VOTE') phone.emit('vote:cast', { choice: 'A' });
        if (p.phase === 'FINALE_WRITE') phone.emit('finale:submit', { text: WRITE_INS[i] });
      });
      phone.on('finale:ballot', (b) => phone.emit('finale:rank', { order: b.policies.map((x) => x.id) }));
    }
    // One phone drops and comes back mid-game (by name, without its token).
    host.once('world:reveal', async () => {
      clients[3].close();
      await new Promise((r) => setTimeout(r, 30));
      const back = connect({ clientType: 'phone' });
      await once(back, 'connect');
      await back.emitWithAck('lobby:join', { name: NAMES[2], room: roomCode });
      back.on('phase', (p) => {
        if (p.phase === 'VOTE') back.emit('vote:cast', { choice: 'B' });
        if (p.phase === 'FINALE_WRITE') back.emit('finale:submit', { text: WRITE_INS[2] });
      });
      back.on('finale:ballot', (b) => back.emit('finale:rank', { order: b.policies.map((x) => x.id) }));
    });
    const ended = once(host, 'game:end');
    await host.emitWithAck('host:start', {});
    await ended;
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    loom.moderate = realModerate;
    for (const c of clients) c.close();
    for (const code of Array.from(engine.rooms.keys())) engine.closeRoom(code);
    io.close();
    await new Promise((resolve) => server.close(resolve));
    Object.assign(console, saved);
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }

  const all = lines.join('\n');
  assert.ok(lines.length > 20, `the game logged (${lines.length} lines)`);
  assert.match(all, /NODE-0[1-5]/, 'logs refer to node ids');
  assert.match(all, /\[loom\] moderate/, 'the Loom call was logged');
  for (const name of NAMES) {
    for (const part of name.split(' ')) assert.ok(!all.includes(part), `log leaked "${part}"`);
  }
  assert.ok(!/zygomorphic/.test(all), 'no write-in text in the logs');
});
