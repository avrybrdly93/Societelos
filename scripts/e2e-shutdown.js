#!/usr/bin/env node
'use strict';

// TASK-760: Full End-to-End Shutdown Test #6. A projector page and 5 phone
// pages play a real game through the server (offline Loom, shrunk timers).
// Cycles 1-2 run on the authored data; every Cycle 3 option in all four
// worlds is then forced to the most negative effect vector (-1 on all six
// traits), so the real simulation drives realized GDW to 0% during Cycle 3.
//
// Checks: the collapse happens in Cycle 3, that RESOLUTION goes straight to
// END (no Cycle 4, no finale), game:end reports SHUTDOWN with no winner, the
// projector shows the End Screen in its shutdown styling with a GDW line
// that stops at 0, and every phone shows "THE LOOM HAS SHUT DOWN".
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:shutdown          # SHOT_DIR=/some/dir saves host + phone PNGs
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:shutdown needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

const COLLAPSE = { purpose: -1, connection: -1, health: -1, trust: -1, fairness: -1, autonomy: -1 };

/** Deep copy of the game's content with every Cycle 3 option forced to COLLAPSE. */
function forceCycle3Collapse(data) {
  const copy = JSON.parse(JSON.stringify(data));
  let forced = 0;
  for (const c of (copy.crises && copy.crises.crises) || []) {
    if (c.cycle !== 3) continue;
    for (const o of Object.values(c.options || {})) {
      o.effects = { ...COLLAPSE };
      delete o.effectsByWorld;
      forced++;
    }
  }
  return { copy, forced };
}

(async () => {
  const log = console.log; console.log = () => {};
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];

  async function open(name, viewport, url) {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on('pageerror', (e) => errors.push(`${name} PAGEERROR: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`); });
    await page.goto(url);
    return page;
  }

  const host = await open('host', { width: 1920, height: 1080 }, `${origin}/`);
  await host.waitForSelector('#room-code', { state: 'attached' });
  await host.waitForTimeout(500);
  const game = engine.getLatestRoom();
  const { copy, forced } = forceCycle3Collapse(game.data);
  game.data = copy;
  const phases = [];
  const resolutions = [];
  let gameEnd = null;
  game.on('phase', (p) => phases.push(`${p.cycle}:${p.phase}`));
  game.on('resolution', (r) => resolutions.push(r));
  game.on('game:end', (d) => { gameEnd = d; });

  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 }, `${origin}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await host.waitForTimeout(800);
  await host.click('#btn-start');

  const deadline = Date.now() + 150000;
  while (Date.now() < deadline && game.phase !== 'END') {
    if (game.phase === 'VOTE') {
      await Promise.all(phones.map((p, i) => p.click(i < 3 ? '#vote-a' : '#vote-b', { timeout: 1000 }).catch(() => {})));
    }
    await host.waitForTimeout(200);
  }
  await host.waitForTimeout(2500);

  const problems = [];
  if (forced !== 8) problems.push(`expected 8 Cycle 3 options to force (4 worlds x A/B), forced ${forced}`);
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);
  const after = phases.slice(phases.indexOf('3:RESOLUTION'));
  if (after.join(' ') !== '3:RESOLUTION 3:END') problems.push(`after Cycle 3 RESOLUTION: ${after.join(' ')} (want 3:RESOLUTION 3:END)`);
  if (phases.some((p) => /^[45]:/.test(p))) problems.push('Cycle 4 or 5 was played after the shutdown');
  if (resolutions.length !== 3) problems.push(`expected 3 resolutions, got ${resolutions.length}`);
  else if (!(resolutions[1].gdw > 0) || resolutions[2].gdw !== 0) problems.push(`GDW after C2 ${resolutions[1].gdw}, after C3 ${resolutions[2].gdw}`);
  if (game.ending !== 'shutdown') problems.push(`game.ending ${game.ending}`);
  if (!gameEnd) problems.push('no game:end');
  else {
    if (!gameEnd.shutdown || gameEnd.grade !== 'SHUTDOWN') problems.push(`game:end shutdown ${gameEnd.shutdown}, grade ${gameEnd.grade}`);
    if (gameEnd.winner !== null) problems.push(`game:end winner ${JSON.stringify(gameEnd.winner)} (everyone loses)`);
    if (gameEnd.cyclesPlayed !== 3) problems.push(`cyclesPlayed ${gameEnd.cyclesPlayed}`);
    if (gameEnd.finaleMode !== 'none') problems.push(`finaleMode ${gameEnd.finaleMode}`);
    if (gameEnd.gdwHistory.at(-1) !== 0) problems.push(`gdwHistory ends at ${gameEnd.gdwHistory.at(-1)}`);
  }

  const view = await host.evaluate(() => {
    const v = document.getElementById('view-end');
    return {
      active: v.classList.contains('is-active'),
      shutdown: v.classList.contains('is-shutdown'),
      title: document.getElementById('end-winner-title').textContent.trim(),
      rows: document.querySelectorAll('#end-roles-body tr').length
    };
  });
  if (!view.active) problems.push('projector is not on the End Screen');
  if (!view.shutdown) problems.push('projector End Screen lacks the shutdown styling');
  if (!view.title) problems.push('projector End Screen has no title');
  if (view.rows !== 5) problems.push(`projector shows ${view.rows} role rows (want 5)`);
  for (const [i, p] of phones.entries()) {
    const r = await p.evaluate(() => ({
      active: document.getElementById('m-view-end').classList.contains('is-active') || !document.getElementById('m-view-end').hidden,
      outcome: document.getElementById('end-outcome').textContent,
      grade: document.getElementById('end-grade').textContent
    }));
    if (r.outcome !== 'THE LOOM HAS SHUT DOWN' || r.grade !== 'SHUTDOWN') problems.push(`phone${i + 1}: "${r.outcome}" grade ${r.grade}`);
  }
  const shots = process.env.SHOT_DIR;
  if (shots) {
    await host.screenshot({ path: path.join(shots, 'e2e-shutdown-host.png') });
    await phones[0].screenshot({ path: path.join(shots, 'e2e-shutdown-phone.png') });
  }
  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  if (problems.length) {
    process.stderr.write('E2E SHUTDOWN FAILED:\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
  process.stderr.write(`E2E SHUTDOWN OK: GDW ${resolutions[1].gdw} after Cycle 2 -> 0 in Cycle 3 (world ${game.worldKey}); RESOLUTION -> END, grade SHUTDOWN, no winner; projector "${view.title}", 5 phones show the shutdown\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E SHUTDOWN FAILED ' + e.stack + '\n'); process.exit(1); });
