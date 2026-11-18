#!/usr/bin/env node
'use strict';

// host:playAgain browser check (TASK-686, TASK-692, TASK-694, TASK-695).
// Plays one full game to the End Screen (real server in-process, moderation
// stubbed so the write-in finale runs offline): the projector and one
// phone are Chromium pages, the other 4 phones are socket clients. Then the
// teacher presses PLAY AGAIN and the projector and the phone must look
// exactly like a fresh lobby again:
//   host  - lobby view, CYCLE 0/5, GDW 25.0%, no world theme, every map
//           district back to its baseline fill, the forecast and End Screen
//           canvases blank, citizen feed / proposals / Borda / End Screen
//           tables empty, no stale panels, no leftover timers redrawing
//   phone - seated (same node) on the waiting screen, no role, intel,
//           vote lock, ballot or end card left over
// Game #2 is then started to confirm it plays from a clean slate.
//   npm run e2e:play-again   (needs Playwright: npm i --no-save playwright)
// Exits 1 on any leftover state or page error, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = '2';
delete process.env.GEMINI_API_KEY;
let chromium;
let devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch (e) {
  console.error('e2e:play-again needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const dir = require('path').join(__dirname, '..', 'server') + '/';
const { server } = require(dir + 'server');
const loom = require(dir + 'loom');
const engine = require(dir + 'gameEngine');
loom.moderate = async (subs) => subs.map((s) => ({ node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: ['artisan'], effects: { purpose: 0.1 } }));
const { io } = require('socket.io-client');

/** Everything on the projector that a finished game could leave behind. */
function hostSnapshot() {
  const $ = (id) => document.getElementById(id);
  const inked = (canvas) => {
    if (!canvas || !canvas.width || !canvas.height) return 0;
    const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4 * 13) if (px[i] > 0) n++;
    return n;
  };
  const shown = (id) => { const el = $(id); return !!el && !el.hidden && !el.closest('[hidden]'); };
  return {
    view: document.querySelector('#host-main > .view.is-active').id,
    cycle: $('cycle-indicator').textContent.trim(),
    gdw: $('gdw-badge').textContent.trim(),
    gdwReadout: $('gdw-readout').textContent.trim(),
    world: document.body.dataset.world || '',
    bodyWorldClass: [...document.body.classList].filter((c) => /world|shutdown/i.test(c)).join(' '),
    mapWorld: $('region-map').dataset.world || '',
    districts: ['D1', 'D2', 'D3', 'D4', 'D5'].map((d) => getComputedStyle($(`district-${d}`)).getPropertyValue('--district-fill').trim()).join(' | '),
    mapMonth: shown('map-month'),
    deltaPill: shown('gdw-delta-pill'),
    forecastInk: inked($('forecast-chart')),
    endChartInk: inked($('end-history-chart')),
    feed: $('citizen-feed').children.length,
    incident: shown('incident-banner'),
    debate: shown('debate-panel'),
    policies: shown('policy-panel'),
    resolution: shown('resolution-panel'),
    finaleCallout: shown('finale-callout'),
    proposals: $('proposal-cards').children.length,
    borda: $('borda-bars').children.length,
    enact: $('enact-cards').children.length,
    endRows: $('end-roles-body').children.length,
    endClasses: $('view-end').className.replace(/\bview\b|\bview-end\b/g, '').trim()
  };
}

/** The phone's leftovers: role card, intel, vote and ballot locks, end card. */
function phoneSnapshot() {
  const $ = (id) => document.getElementById(id);
  const text = (id) => ($(id) ? $(id).textContent.trim() : '');
  return {
    view: document.querySelector('.m-view.is-active').id,
    node: text('m-node-label'),
    phase: window.SocietelosMobile.state.phase,
    world: document.body.dataset.world || '',
    role: text('drawer-role-name'),
    intel: text('intel-drawer-text'),
    voteLocked: !!$('vote-locked') && !$('vote-locked').hidden,
    rankCards: $('rank-cards') ? $('rank-cards').children.length : 0,
    rankLocked: !!$('rank-locked') && !$('rank-locked').hidden
  };
}

(async () => {
  console.log = ((orig) => (...a) => { if (!/^\[(game|socket|loom)/.test(String(a[0]))) orig(...a); })(console.log);
  await new Promise((r) => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const host = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  host.on('pageerror', (e) => errors.push(`host: ${e.message}`));
  await host.goto(URL + '/');
  await host.waitForFunction(() => window.SocietelosHost && window.SocietelosHost.state.roomCode);
  const room = await host.evaluate(() => window.SocietelosHost.state.roomCode);
  const game = engine.getRoom(room);
  const shorten = () => Object.assign(game.durations, { INTRO: 1000, ROLE_ASSIGN: 1000, CHAMBER: 1000, DEBATE: 1500, WORLD_REVEAL: 1500, FINALE_WRITE: 4000, FINALE_RANK: 4000, FINALE_DEBATE: 1500 });
  shorten();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await phone.goto(URL + '/mobile');
  await phone.fill('#join-name', 'Replayer');
  await phone.click('#join-submit');
  await phone.waitForTimeout(400);
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const s = io(URL, { auth: { clientType: 'phone' }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await s.emitWithAck('lobby:join', { name: `Bot ${i}`, room });
    await s.emitWithAck('lobby:ready', { ready: true });
    s.on('phase', (p) => {
      if (p.phase === 'VOTE') setTimeout(() => s.emit('vote:cast', { choice: i < 2 ? 'A' : 'B' }), 200);
      if (p.phase === 'FINALE_WRITE') setTimeout(() => s.emit('finale:submit', { text: `Bot policy ${i}` }), 300);
    });
    s.on('finale:ballot', (b) => setTimeout(() => s.emit('finale:rank', { order: b.policies.map((x) => x.id) }), 300));
    bots.push(s);
  }
  // The browser phone votes, writes and ranks like a student would.
  let phoneBusy = false;
  const phoneLoop = setInterval(async () => {
    if (phoneBusy) return;
    phoneBusy = true;
    try {
      const st = await phone.evaluate(() => ({ phase: window.SocietelosMobile.state.phase }));
      if (st.phase === 'VOTE' && await phone.isVisible('#vote-a')) await phone.click('#vote-a').catch(() => {});
      if (st.phase === 'FINALE_WRITE' && await phone.isEnabled('#finale-submit').catch(() => false) && await phone.isVisible('#finale-text')) {
        await phone.fill('#finale-text', 'Every district runs its own repair council.').catch(() => {});
        await phone.click('#finale-submit').catch(() => {});
      }
      if (st.phase === 'FINALE_RANK' && await phone.isVisible('#rank-submit')) {
        const n = await phone.locator('#rank-cards > *').count();
        for (let i = 0; i < n; i++) await phone.click(`#rank-cards > * >> nth=${i}`).catch(() => {});
        await phone.click('#rank-submit').catch(() => {});
      }
    } catch (e) { /* page busy navigating views */ }
    phoneBusy = false;
  }, 400);

  const fresh = await host.evaluate(hostSnapshot);
  const freshPhone = await phone.evaluate(phoneSnapshot);
  await host.click('#btn-start');
  await host.waitForFunction(() => window.SocietelosHost.state.phase === 'END', null, { timeout: 240000 });
  await host.waitForTimeout(1500);
  const ended = await host.evaluate(hostSnapshot);
  const endedPhone = await phone.evaluate(phoneSnapshot);

  // PLAY AGAIN: the same five stay seated.
  await host.evaluate(() => document.getElementById('view-end').classList.add('beat-3'));
  await host.click('#btn-play-again');
  await host.waitForFunction(() => window.SocietelosHost.state.phase === 'LOBBY', null, { timeout: 10000 });
  await phone.waitForFunction(() => window.SocietelosMobile.state.phase === 'LOBBY', null, { timeout: 10000 });
  await host.waitForTimeout(2500); // any stray playback/animation timer would repaint by now
  const after = await host.evaluate(hostSnapshot);
  const afterPhone = await phone.evaluate(phoneSnapshot);

  const problems = [];
  if (ended.view !== 'view-end') problems.push(`game did not reach the End Screen (${ended.view})`);
  if (!ended.endRows || !ended.endChartInk) problems.push('End Screen was not populated, so the reset proves nothing');
  for (const [k, v] of Object.entries(fresh)) {
    if (k === 'forecastInk' || k === 'endChartInk') {
      if (after[k] > v) problems.push(`host ${k}: ${after[k]} inked samples after reset (fresh lobby ${v})`);
    } else if (JSON.stringify(after[k]) !== JSON.stringify(v)) {
      problems.push(`host ${k}: fresh ${JSON.stringify(v)} -> after reset ${JSON.stringify(after[k])}`);
    }
  }
  const wantPhone = { view: 'm-view-wait', node: endedPhone.node, phase: 'LOBBY', world: freshPhone.world, role: freshPhone.role, intel: freshPhone.intel, voteLocked: false, rankCards: 0, rankLocked: false };
  for (const [k, v] of Object.entries(wantPhone)) {
    if (JSON.stringify(afterPhone[k]) !== JSON.stringify(v)) problems.push(`phone ${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(afterPhone[k])}`);
  }

  // Game #2 starts clean: Cycle 1 opens at GDW 25% with an empty feed history.
  shorten();
  await host.click('#btn-start').catch(() => {});
  await host.waitForFunction(() => window.SocietelosHost.state.phase === 'INCIDENT', null, { timeout: 30000 }).catch(() => problems.push('Game #2 never reached INCIDENT'));
  const game2 = await host.evaluate(hostSnapshot);
  if (game2.cycle !== 'CYCLE 1/5') problems.push(`Game #2 cycle indicator ${game2.cycle}`);
  if (game2.gdw !== fresh.gdw) problems.push(`Game #2 opens at ${game2.gdw}, not ${fresh.gdw}`);
  if (game2.world) problems.push(`Game #2 still themed as ${game2.world}`);
  if (game2.endRows || game2.proposals || game2.borda) problems.push('Game #2 shows Game #1 finale/End Screen rows');

  clearInterval(phoneLoop);
  bots.forEach((s) => s.close());
  await browser.close();
  server.close();
  problems.push(...errors);
  console.log(`game #1: ${ended.view} (${ended.endRows} end rows); after PLAY AGAIN host ${after.view}, phone ${afterPhone.view} ${afterPhone.node}; game #2 ${game2.cycle}`);
  if (problems.length) {
    console.log('E2E PLAY AGAIN FAILED:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('E2E PLAY AGAIN OK: projector and phone reset to a fresh lobby');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
