#!/usr/bin/env node
'use strict';

// TASK-766: Full End-to-End Replay Seed Test #12. A projector page and 5
// phone pages play a complete game through the real server (offline Loom,
// so Cycle 5 uses the authored A/B finale). The seed is read off the
// projector's End Screen badge, the teacher presses PLAY AGAIN, types that
// seed into the lobby's Replay seed box and starts Game #2, and the phones
// cast exactly the same votes (one Override in the same cycle).
//
// Game #2 must reproduce Game #1 bit for bit: the realized GDW line of every
// cycle, every citizen shock (district, month, size), each cycle's district
// series, the whole gdwHistory, the winning options, the world and the final
// GDW. A third game with a different seed must differ, so the comparison is
// not vacuous.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:replay
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:replay needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

// Same votes every game: cycle -> phone index -> 'A' | 'B'; phone 3 spends its Override in Cycle 3.
const VOTES = { 1: 'BBABA', 2: 'AABBB', 3: 'ABAAB', 4: 'BBBAA', 5: 'ABABA' };
const OVERRIDE = { cycle: 3, phone: 2 };

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
    page.on('console', (m) => { if (m.type() === 'error' && !/navigator\.vibrate/.test(m.text())) errors.push(`${name} console.error: ${m.text()}`); });
    await page.goto(url);
    return page;
  }

  const host = await open('host', { width: 1920, height: 1080 }, `${origin}/`);
  await host.waitForFunction(() => window.SocietelosHost && window.SocietelosHost.state.roomCode);
  const roomCode = await host.evaluate(() => window.SocietelosHost.state.roomCode);
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 }, `${origin}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await Promise.all(phones.map((p) => p.waitForFunction(() => (JSON.parse(sessionStorage.getItem('societelos.session') || '{}') || {}).node, null, { timeout: 5000 })));
  await host.waitForTimeout(500);

  /** Start (optionally on a seed) and play one game; returns what it produced. */
  async function playOne(seed) {
    const game = engine.getRoom(roomCode);
    const cycles = [];
    const onResolution = (r) => {
      const res = r.result || {};
      cycles.push({
        cycle: res.cycle,
        winner: res.winner,
        gdw: Array.from((r.realized && r.realized.gdw) || []),
        shocks: JSON.stringify((r.realized && r.realized.shocks) || []),
        districts: JSON.stringify((r.realized && r.realized.districts) || [])
      });
    };
    game.on('resolution', onResolution);
    // The lobby keeps the last seed typed; a fresh game clears the box.
    await host.fill('#seed-input', seed || '');
    if (seed) {
      await host.fill('#seed-input', seed).catch(() => host.evaluate((s) => {
        const el = document.getElementById('seed-input');
        el.value = s;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, seed));
    }
    await host.click('#btn-start');
    const acted = new Set();
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && game.phase !== 'END') {
      const key = `${game.cycle}:${game.phase}`;
      if (game.phase === 'VOTE' && !acted.has(key)) {
        acted.add(key);
        const votes = VOTES[game.cycle];
        const cycle = game.cycle;
        await Promise.all(phones.map(async (p, i) => {
          await p.waitForSelector('#m-view-vote.is-active #vote-a', { timeout: 4000 });
          const btn = votes[i] === 'A' ? '#vote-a' : '#vote-b';
          if (cycle === OVERRIDE.cycle && i === OVERRIDE.phone) {
            await p.click('#override-row');
            await p.click(btn); // arms the doubled vote
          }
          await p.click(btn);
        }).map((pr) => pr.catch((e) => problems.push(`vote ${key}: ${e.message.split('\n')[0]}`))));
      }
      await host.waitForTimeout(150);
    }
    await host.waitForTimeout(1500);
    game.off('resolution', onResolution); // the room's GameState is reused by PLAY AGAIN
    const badge = await host.textContent('#end-seed').catch(() => '');
    return {
      gameId: game.gameId,
      badge: (badge || '').replace(/^SEED\s+/, '').trim(),
      phase: game.phase,
      cycles,
      world: game.worldKey,
      finalGdw: game.gdw,
      history: JSON.stringify(game.gdwHistory),
      votes: JSON.stringify(game.voteHistory)
    };
  }

  async function playAgain() {
    await host.evaluate(() => document.getElementById('view-end').classList.add('beat-3'));
    await host.click('#btn-play-again');
    await host.waitForFunction(() => window.SocietelosHost.state.phase === 'LOBBY', null, { timeout: 10000 });
    await host.waitForTimeout(1200);
  }

  const first = await playOne(null);
  if (first.phase !== 'END') problems.push(`Game #1 stopped at ${first.phase}`);
  if (!first.badge || first.badge !== first.gameId) problems.push(`End Screen seed badge "${first.badge}" vs game id ${first.gameId}`);
  await playAgain();
  const second = await playOne(first.badge);
  await playAgain();
  const third = await playOne(null);

  if (second.phase !== 'END') problems.push(`Game #2 stopped at ${second.phase}`);
  if (second.gameId !== first.gameId) problems.push(`Game #2 ran on seed ${second.gameId}, not ${first.gameId}`);
  if (first.cycles.length !== 5) problems.push(`Game #1 resolved ${first.cycles.length} cycles`);
  if (second.cycles.length !== first.cycles.length) problems.push(`Game #2 resolved ${second.cycles.length} cycles, Game #1 ${first.cycles.length}`);
  first.cycles.forEach((c, i) => {
    const d = second.cycles[i] || {};
    if (JSON.stringify(c.gdw) !== JSON.stringify(d.gdw)) problems.push(`cycle ${c.cycle}: realized GDW differs`);
    if (c.shocks !== d.shocks) problems.push(`cycle ${c.cycle}: citizen shocks differ`);
    if (c.districts !== d.districts) problems.push(`cycle ${c.cycle}: district series differ`);
    if (c.winner !== d.winner) problems.push(`cycle ${c.cycle}: winner ${c.winner} vs ${d.winner}`);
  });
  for (const k of ['history', 'world', 'finalGdw', 'votes']) if (first[k] !== second[k]) problems.push(`${k}: ${first[k]} vs ${second[k]}`);
  const shockCount = first.cycles.reduce((n, c) => n + JSON.parse(c.shocks).length, 0);
  if (!shockCount) problems.push('Game #1 had no citizen shocks, so the shock comparison proves nothing');
  if (third.gameId === first.gameId) problems.push('Game #3 reused the seed');
  else if (third.history === first.history) problems.push('a different seed produced the identical GDW history');

  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  if (problems.length) {
    process.stderr.write(`E2E REPLAY FAILED:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  process.stderr.write(`E2E REPLAY OK: seed ${first.gameId} (from the End Screen badge) replayed via the lobby box with identical votes: ${first.cycles.length} cycles, ${JSON.parse(first.history).length} GDW points and ${shockCount} citizen shocks bit-for-bit identical (world ${first.world}, final GDW ${first.finalGdw}); a fresh seed differs (final GDW ${third.finalGdw})\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E REPLAY FAILED ' + e.stack + '\n'); process.exit(1); });
