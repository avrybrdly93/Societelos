#!/usr/bin/env node
'use strict';

// TASK-697 / TASK-759: prove the frontend is 100% offline-capable. A projector page and
// 5 phone pages play a complete game (Lobby -> END, no Gemini key, so the
// Loom runs on its offline fallbacks) inside an air-gapped browser: every
// request that is not to the local game server (or a data:/blob: URL) is
// aborted and recorded. Also loads the QR-join path and checks that no web
// font is in use beyond the system stacks.
//
// Fails if any external request (fonts, icons, analytics, CDNs...) was
// attempted, a local asset failed to load, a page raised an error, the game
// did not reach the End Screen, a cycle lacked its offline narration, or
// Cycle 5 did not fall back to the authored A/B finale.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:offline
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:offline needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

(async () => {
  const log = console.log; console.log = () => {};
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const external = [];
  const failedLocal = [];
  const errors = [];
  const requested = new Set();

  async function airGappedPage(name, viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      external.push(`${name}: ${url}`);
      return route.abort('internetdisconnected');
    });
    const page = await ctx.newPage();
    page.on('request', (r) => { if (r.url().startsWith(origin)) requested.add(new URL(r.url()).pathname); });
    page.on('requestfailed', (r) => {
      const url = r.url();
      // socket.io long-poll requests are cancelled when the transport upgrades.
      if (url.startsWith(origin) && !url.includes('/socket.io/')) failedLocal.push(`${name}: ${url} (${r.failure() && r.failure().errorText})`);
    });
    page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) failedLocal.push(`${name}: ${r.url()} HTTP ${r.status()}`); });
    page.on('pageerror', (e) => errors.push(`${name} PAGEERROR: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`); });
    return page;
  }

  const host = await airGappedPage('host', { width: 1920, height: 1080 });
  await host.goto(`${origin}/`);
  await host.waitForSelector('#room-code', { state: 'attached' });
  await host.waitForTimeout(500);
  const game = engine.getLatestRoom();
  // TASK-759: record every phase and resolution to verify the offline fallbacks.
  const phases = [];
  const resolutions = [];
  game.on('phase', (p) => phases.push(`${p.cycle}:${p.phase}`));
  game.on('resolution', (r) => resolutions.push(r));
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await airGappedPage(`phone${i + 1}`, { width: 390, height: 844 });
    // Phone 1 arrives through the QR-code URL (?room=CODE); the rest type it.
    await p.goto(i === 0 ? `${origin}/mobile?room=${game.roomCode}` : `${origin}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await host.waitForTimeout(800);
  await host.click('#btn-start');

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && game.phase !== 'END') {
    if (game.phase === 'VOTE') {
      await Promise.all(phones.map((p, i) => p.click(i < 3 ? '#vote-a' : '#vote-b', { timeout: 1000 }).catch(() => {})));
    }
    await host.waitForTimeout(200);
  }
  await host.waitForTimeout(1500);

  // Web fonts: only system stacks are allowed, so no @font-face may load.
  const fonts = [];
  for (const [name, p] of [['host', host], ['phone1', phones[0]]]) {
    const loaded = await p.evaluate(() => [...document.fonts].filter((f) => f.status !== 'unloaded').map((f) => f.family));
    if (loaded.length) fonts.push(`${name}: ${loaded.join(', ')}`);
  }

  const problems = [];
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);
  // Offline fallbacks: authored/template narration every cycle, and Cycle 5
  // on the authored A/B finale (no write-ins can be moderated without the Loom).
  if (resolutions.length !== 5) problems.push(`expected 5 resolutions, got ${resolutions.length}`);
  resolutions.forEach((r, i) => {
    if (!r.loomLine || !(r.messages || []).length) problems.push(`cycle ${i + 1}: missing offline Loom line or citizen messages`);
  });
  const finaleMode = game.endData && game.endData.finaleMode;
  if (finaleMode !== 'fallback') problems.push(`Cycle 5 finaleMode ${finaleMode}, expected the authored A/B fallback`);
  if (!phases.includes('5:VOTE') || phases.includes('5:FINALE_DEBATE')) problems.push(`Cycle 5 did not play the A/B fallback: ${phases.filter((p) => p.startsWith('5:')).join(' ')}`);
  const endShown = await host.evaluate(() => document.getElementById('view-end').classList.contains('is-active'));
  if (!endShown) problems.push('the projector is not on the End Screen');
  if (external.length) problems.push(`external requests attempted:\n  ${[...new Set(external)].join('\n  ')}`);
  if (failedLocal.length) problems.push(`local requests failed:\n  ${failedLocal.join('\n  ')}`);
  if (fonts.length) problems.push(`web fonts loaded: ${fonts.join('; ')}`);
  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  const paths = [...requested].filter((p) => !p.startsWith('/socket.io')).sort();
  process.stderr.write(`local assets requested: ${paths.join(' ')}\n`);
  if (problems.length) {
    process.stderr.write('E2E OFFLINE FAILED:\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
  process.stderr.write(`E2E OFFLINE OK: full game to the End Screen (cycle ${game.cycle}, GDW ${game.gdw}, finale ${finaleMode}) with offline narration every cycle and zero external requests\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E OFFLINE FAILED ' + e.stack + '\n'); process.exit(1); });
