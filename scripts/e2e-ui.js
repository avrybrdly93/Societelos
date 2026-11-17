#!/usr/bin/env node
'use strict';

// End-to-end UI simulation: a Chromium projector page and 5 phone pages join,
// vote and play Cycles 1-4 (plus the world reveal) on shortened timers, then
// report the phase sequence, the world built and any console errors. It also
// checks the world reveal themed the projector, recoloured the map and themed
// the phones.
//
// Needs Playwright with Chromium (not a project dependency, so CI stays light):
//   npm i --no-save playwright && npx playwright install chromium
//   npm run e2e:ui            # FAST_TIMER_SECONDS=1.2 by default
// Exits non-zero if the run stalls, cycles 1-4 are not all played, or a page
// logs an error.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1.2';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:ui needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));
(async () => {
  const log = console.log; console.log = () => {};
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const consoleMsgs = [];
  const watch = (page, name) => {
    page.on('console', (m) => consoleMsgs.push(`${name} ${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => consoleMsgs.push(`${name} PAGEERROR: ${e.message}`));
  };
  const host = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(host, 'host');
  await host.goto(base + '/?intro=off');
  await host.waitForTimeout(500);
  const game = engine.getLatestRoom();
  game.gameId = process.env.GAME_ID || 'e2eflow00001';
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    watch(p, `phone${i + 1}`);
    await p.goto(base + '/mobile');
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await host.waitForTimeout(800);
  await host.click('#btn-start');
  const seen = new Set();
  const hostPhases = [];
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const ph = `${game.cycle}:${game.phase}`;
    if (!seen.has(ph)) { seen.add(ph); hostPhases.push(ph); }
    if (game.phase === 'VOTE') {
      for (let i = 0; i < 5; i++) {
        const p = phones[i];
        const visible = await p.isVisible('#vote-a').catch(() => false);
        if (visible && !game.votes[Object.keys(game.players)[i]]) {
          const choice = game.cycle === 2 ? 'B' : i < 3 ? 'A' : 'B';
          await p.click(choice === 'A' ? '#vote-a' : '#vote-b').catch(() => {});
        }
      }
    }
    if (game.cycle >= 5 || game.phase === 'END') break;
    await host.waitForTimeout(150);
  }
  // Optional screenshots of the final state: SHOT_DIR=/some/dir npm run e2e:ui
  const out = process.env.SHOT_DIR;
  if (out) { await host.screenshot({ path: out + '/e2e-host.png' }); await phones[0].screenshot({ path: out + '/e2e-phone.png' }); }
  const hostText = await host.textContent('#world-name');
  // World reveal applied in the browser: host theme, map recolour, phone theme.
  const themed = {
    hostBody: await host.evaluate(() => document.body.dataset.world || null),
    hostClass: await host.evaluate(() => document.body.className),
    map: await host.evaluate(() => document.getElementById('region-map').dataset.world || null),
    mapAccent: await host.evaluate(() => getComputedStyle(document.getElementById('region-map')).getPropertyValue('--map-accent').trim()),
    phone: await phones[0].evaluate(() => document.body.dataset.world || null)
  };
  console.log = log;
  if (consoleMsgs.length) process.stderr.write('console:\n' + consoleMsgs.join('\n') + '\n');
  process.stderr.write(JSON.stringify({ phases: hostPhases.join(' '), voteHistory: game.voteHistory, worldKey: game.worldKey, hostWorld: hostText, gdw: game.gdw }) + '\n');
  const problems = consoleMsgs.filter((m) => / (error|PAGEERROR)/.test(m));
  for (const c of [1, 2, 3, 4]) {
    for (const p of ['INCIDENT', 'DEBATE', 'VOTE', 'RESOLUTION']) {
      if (!seen.has(`${c}:${p}`)) problems.push(`missing ${c}:${p}`);
    }
  }
  if (!seen.has('2:WORLD_REVEAL')) problems.push('missing world reveal');
  const wk = game.worldKey;
  if (themed.hostBody !== wk || !themed.hostClass.includes(`world-${String(wk).toLowerCase()}`)) problems.push(`host not themed for ${wk}: ${JSON.stringify(themed)}`);
  if (themed.map !== wk || !themed.mapAccent) problems.push(`map not recoloured for ${wk}: ${JSON.stringify(themed)}`);
  if (themed.phone !== wk) problems.push(`phone not themed for ${wk}: ${JSON.stringify(themed)}`);
  if (hostText !== engine.loadGameData().crises.worlds[wk].name) problems.push(`world title "${hostText}"`);
  await browser.close();
  if (problems.length) {
    process.stderr.write('E2E FAILED:\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
  process.stderr.write('E2E OK: cycles 1-4 played in the browser with a clean console\n');
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E FAILED ' + e.stack + '\n'); process.exit(1); });
