#!/usr/bin/env node
'use strict';
// TASK-666 browser check: a phone refreshed during ROLE_ASSIGN, INTEL, VOTE
// (after voting), FINALE_WRITE (after submitting) and FINALE_RANK (after
// ranking) lands on the same screen with its role, intel, timer and locks.
// Runs the real server in-process (moderation stubbed so the write-in finale
// runs offline), one Chromium phone (iPhone 13 profile) and 4 socket phones.
//   npm run e2e:refresh   (needs Playwright: npm i --no-save playwright)
process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '4';
delete process.env.GEMINI_API_KEY;
const path = require('path').join(__dirname, '..', 'server') + '/';
const { server } = require(path + 'server');
const loom = require(path + 'loom');
const engine = require(path + 'gameEngine');
loom.moderate = async (subs) => subs.map((s) => ({ node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: ['artisan'], effects: { purpose: 0.1 } }));
let chromium;
let devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch (e) {
  console.error('e2e:refresh needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}
const { io } = require('socket.io-client');
(async () => {
  console.log = ((orig) => (...a) => { if (!String(a[0]).startsWith('[game') && !String(a[0]).startsWith('[socket')) orig(...a); })(console.log);
  await new Promise((r) => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const host = await browser.newPage();
  await host.goto(URL + '/?intro=off');
  await host.waitForFunction(() => window.SocietelosHost && window.SocietelosHost.state.roomCode);
  const room = await host.evaluate(() => window.SocietelosHost.state.roomCode);
  const game = engine.getRoom(room);
  game.durations.DEBATE = 4000; game.durations.FINALE_WRITE = 8000; game.durations.FINALE_RANK = 8000; game.durations.FINALE_DEBATE = 2000;
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const phone = await ctx.newPage();
  const errors = [];
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(URL + '/mobile');
  await phone.fill('#join-name', 'Refresher');
  await phone.click('#join-submit');
  await phone.waitForTimeout(400);
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const s = io(URL, { auth: { clientType: 'phone' }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await s.emitWithAck('lobby:join', { name: `Bot ${i}`, room });
    await s.emitWithAck('lobby:ready', { ready: true });
    s.on('phase', (p) => {
      if (p.phase === 'VOTE') setTimeout(() => s.emit('vote:cast', { choice: 'A' }), 3000);
      if (p.phase === 'FINALE_WRITE') setTimeout(() => s.emit('finale:submit', { text: `Bot policy ${i}` }), 5000);
    });
    s.on('finale:ballot', (b) => setTimeout(() => s.emit('finale:rank', { order: b.policies.map((x) => x.id) }), 6000));
    bots.push(s);
  }
  await host.click('#btn-start');
  const results = {};
  const atPhase = (ph, cycle) => phone.waitForFunction(([ph, c]) => window.SocietelosMobile.state.phase === ph && (c === undefined || window.SocietelosMobile.state.cycle === c), [ph, cycle], { timeout: 120000 });
  const snapshot = () => phone.evaluate(() => ({
    view: document.querySelector('.m-view.is-active').id,
    phase: window.SocietelosMobile.state.phase,
    role: (document.getElementById('drawer-role-name') || {}).textContent || '',
    intel: (document.getElementById('intel-drawer-text') || {}).textContent || '',
    endsAt: window.SocietelosMobile.state.endsAt,
    voteLocked: !document.getElementById('vote-locked').hidden,
    rankLocked: !document.getElementById('rank-locked').hidden
  }));
  async function refresh(label) {
    const before = await snapshot();
    await phone.reload();
    await phone.waitForFunction((ph) => window.SocietelosMobile.state.phase === ph, before.phase, { timeout: 10000 });
    await phone.waitForTimeout(400);
    const after = await snapshot();
    results[label] = { same: before.view === after.view, before: before.view, after: after.view, role: !!after.role, timerKept: Math.abs((after.endsAt || 0) - (before.endsAt || 0)) < 50, voteLocked: after.voteLocked, rankLocked: after.rankLocked, intelSame: before.intel === after.intel };
  }
  await atPhase('ROLE_ASSIGN'); await phone.waitForTimeout(500); await refresh('ROLE_ASSIGN');
  await atPhase('INTEL', 1); await phone.waitForTimeout(500); await refresh('INTEL');
  await atPhase('VOTE', 1); await phone.waitForTimeout(300); await phone.click('.vote-btn >> nth=0'); await phone.waitForTimeout(400); await refresh('VOTE');
  await atPhase('FINALE_WRITE'); await phone.fill('#finale-text', 'Refresh-proof policy'); await phone.click('#finale-submit'); await phone.waitForTimeout(400); await refresh('FINALE_WRITE');
  await atPhase('FINALE_RANK');
  await phone.waitForTimeout(400);
  for (let i = 0; i < 4; i++) await phone.click(`#rank-cards > * >> nth=${i}`);
  await phone.click('#rank-submit'); await phone.waitForTimeout(400); await refresh('FINALE_RANK');
  bots.forEach((s) => s.close());
  await browser.close();
  let ok = errors.length === 0;
  for (const [label, r] of Object.entries(results)) {
    const pass = r.same && r.role && r.timerKept && r.intelSame &&
      (label !== 'VOTE' || r.voteLocked) && (label !== 'FINALE_RANK' || r.rankLocked);
    ok = ok && pass;
    process.stdout.write(`${pass ? 'ok  ' : 'FAIL'} refresh during ${label}: ${r.after}${label === 'VOTE' ? ' (vote locked)' : ''}${label === 'FINALE_RANK' ? ' (ballot locked)' : ''}\n`);
  }
  if (errors.length) process.stdout.write(`page errors: ${JSON.stringify(errors)}\n`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
