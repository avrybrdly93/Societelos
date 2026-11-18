#!/usr/bin/env node
'use strict';

// TASK-761: Full End-to-End Reconnect Test #7. A projector page and 5 phone
// pages play through the real server (offline Loom, shrunk timers).
//
// In Cycle 2: two phones drop off the network during INCIDENT (their tabs
// navigate away, closing the socket), the projector is refreshed during
// DEBATE, and then both phones come back (same tab, so the saved
// sessionStorage token reclaims the seat). The cycle must then finish
// normally: all 5 phones vote from their own screens (none defaulted by the
// timer), RESOLUTION is reached and shown on the refreshed projector, and the
// game plays on to the End Screen with every seat still connected.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:reconnect
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '2';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:reconnect needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

const DROPPED = [2, 3]; // phone indexes that lose their connection in Cycle 2

(async () => {
  const log = console.log; console.log = () => {};
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const problems = [];

  async function open(name, viewport, url) {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on('pageerror', (e) => errors.push(`${name} PAGEERROR: ${e.message}`));
    page.on('console', (m) => {
      // Ignored: closed-socket noise from a tab navigated away mid-game, and Chromium's
      // vibrate intervention on a reloaded tab nobody has tapped yet.
      if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|net::|navigator\.vibrate/i.test(m.text())) errors.push(`${name} console.error: ${m.text()}`);
    });
    await page.goto(url);
    return page;
  }

  const host = await open('host', { width: 1920, height: 1080 }, `${origin}/`);
  await host.waitForFunction(() => window.SocietelosHost && window.SocietelosHost.state.roomCode);
  const roomCode = await host.evaluate(() => window.SocietelosHost.state.roomCode);
  const game = engine.getRoom(roomCode);
  const phases = [];
  const resolutions = [];
  game.on('phase', (p) => phases.push(`${p.cycle}:${p.phase}`));
  game.on('resolution', (r) => resolutions.push(r));
  // Votes cast by phones themselves (the engine's timer default bypasses castVote).
  const votedBy = {};
  const castVote = game.castVote.bind(game);
  game.castVote = (node, ...rest) => {
    const r = castVote(node, ...rest);
    (votedBy[game.cycle] = votedBy[game.cycle] || new Set()).add(node);
    return r;
  };

  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 }, `${origin}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await host.waitForTimeout(800);
  await Promise.all(phones.map((p) => p.waitForFunction(() => (JSON.parse(sessionStorage.getItem('societelos.session') || '{}') || {}).node, null, { timeout: 5000 })));
  const nodes = await Promise.all(phones.map((p) => p.evaluate(() => (JSON.parse(sessionStorage.getItem('societelos.session') || '{}') || {}).node)));
  await host.click('#btn-start');

  const steps = { dropped: false, hostRefreshed: false, back: false };
  const connected = {};
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && game.phase !== 'END') {
    if (game.cycle === 2 && game.phase === 'INCIDENT' && !steps.dropped) {
      steps.dropped = true;
      await Promise.all(DROPPED.map((i) => phones[i].goto('about:blank')));
      await host.waitForTimeout(400);
      DROPPED.forEach((i) => { connected[`drop:${nodes[i]}`] = game.players[nodes[i]] && game.players[nodes[i]].connected; });
    }
    if (game.cycle === 2 && game.phase === 'DEBATE' && !steps.hostRefreshed) {
      steps.hostRefreshed = true;
      await host.reload();
      await host.waitForFunction(() => window.SocietelosHost && window.SocietelosHost.state.roomCode);
      const again = await host.evaluate(() => window.SocietelosHost.state.roomCode);
      if (again !== roomCode) problems.push(`refreshed projector joined room ${again}, not ${roomCode}`);
      await Promise.all(DROPPED.map((i) => phones[i].goto(`${origin}/mobile`)));
      await host.waitForTimeout(800);
      steps.back = true;
      DROPPED.forEach((i) => { connected[`back:${nodes[i]}`] = game.players[nodes[i]] && game.players[nodes[i]].connected; });
    }
    if (game.phase === 'VOTE') {
      await Promise.all(phones.map((p, i) => p.click(i < 3 ? '#vote-a' : '#vote-b', { timeout: 1000 }).catch(() => {})));
    }
    if (game.cycle === 2 && game.phase === 'RESOLUTION' && !steps.resolutionView) {
      await host.waitForTimeout(500);
      steps.resolutionView = await host.evaluate(() => {
        const active = document.querySelector('.view.is-active');
        return active ? active.id : null;
      });
    }
    await host.waitForTimeout(200);
  }
  await host.waitForTimeout(1500);

  if (!steps.dropped || !steps.hostRefreshed || !steps.back) problems.push(`script steps not all reached: ${JSON.stringify(steps)}`);
  for (const i of DROPPED) {
    if (connected[`drop:${nodes[i]}`] !== false) problems.push(`${nodes[i]} was not marked disconnected after dropping`);
    if (connected[`back:${nodes[i]}`] !== true) problems.push(`${nodes[i]} did not reclaim its seat`);
  }
  const c2 = votedBy[2] ? [...votedBy[2]].sort() : [];
  if (c2.length !== 5) problems.push(`Cycle 2: only ${c2.join(', ') || 'no one'} voted from a phone (want all 5)`);
  if (resolutions.length < 2) problems.push(`Cycle 2 did not resolve (${resolutions.length} resolutions)`);
  if (!steps.resolutionView) problems.push('refreshed projector showed no active view at Cycle 2 RESOLUTION');
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);
  const seats = Object.values(game.players).filter((p) => p.connected).length;
  if (seats !== 5) problems.push(`${seats}/5 seats connected at the end`);
  if (Object.keys(game.players).length !== 5) problems.push(`${Object.keys(game.players).length} seats (a reconnect took a new seat?)`);
  const endShown = await host.evaluate(() => document.getElementById('view-end').classList.contains('is-active'));
  if (!endShown) problems.push('the projector is not on the End Screen');
  for (const [i, p] of phones.entries()) {
    const outcome = await p.evaluate(() => document.getElementById('end-outcome').textContent);
    if (/TALLYING/.test(outcome)) problems.push(`phone${i + 1} did not receive game:end`);
  }
  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  if (problems.length) {
    process.stderr.write('E2E RECONNECT FAILED:\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
  process.stderr.write(`E2E RECONNECT OK: ${DROPPED.map((i) => nodes[i]).join(' + ')} dropped in Cycle 2 INCIDENT, projector refreshed in DEBATE (same room ${roomCode}), both phones back in their seats; all 5 voted, Cycle 2 resolved (projector on ${steps.resolutionView}), game reached END with 5/5 connected\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E RECONNECT FAILED ' + e.stack + '\n'); process.exit(1); });
