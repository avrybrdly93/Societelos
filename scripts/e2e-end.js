#!/usr/bin/env node
'use strict';

// Host End Screen layout check (TASK-680, TASK-681): real game:end payloads from the
// engine, rendered on the 1920x1080 projector page through its own debug
// hook (window.debugTriggerEvent), with all three reveal beats shown.
//
// Scenarios:
//   writein   - Cycle 5 ranked write-ins: the author column is shown
//   writein140 - the same with five maximum-length (140-character) write-ins
//   fallback  - the Loom was unavailable, so Cycle 5 used the authored A/B
//               fallback: the write-in author column is hidden, no gap left
//   shutdownC2 / shutdownC3 - GDW hit 0% in Cycle 2 (no world yet) or 3:
//               shutdown styling, a short history chart, no author column
//
// Each scenario must: raise no page error, keep the End Screen inside the
// projector (no horizontal overflow, nothing past the bottom edge), and show
// or hide the author column as its finaleMode says.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:end               # SHOT_DIR=/some/dir saves a PNG per scenario
// Exits 1 on a failed check or page error, 2 if Playwright is missing.

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:end needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const root = path.join(__dirname, '..');
const { playGame, okModeration, withLoom } = require(path.join(root, 'server', 'test', 'playGame'));

/** Finished games straight from the engine (offline, shrunk timers). */
async function buildScenarios() {
  const scenarios = [];
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    const out = await playGame({ gameId: 'e2e-end-writein', world: 'AB' });
    scenarios.push({ name: 'writein', data: out.gameEnd, expect: { authors: true, shutdown: false } });
    // Worst case: five maximum-length (140-character) write-ins.
    const long = (i) => `Proposal ${i + 1}: every district elects a citizen jury that audits the Loom each month and can veto any rule it finds unfair to.`.padEnd(140, '.').slice(0, 140);
    const max = await playGame({ gameId: 'e2e-end-long', world: 'BB', writeIn: long });
    scenarios.push({ name: 'writein140', data: max.gameEnd, expect: { authors: true, shutdown: false } });
  });
  // No moderation stub: the Loom is offline, so Cycle 5 falls back to A/B.
  const fb = await playGame({ gameId: 'e2e-end-fallback', world: 'BA' });
  scenarios.push({ name: 'fallback', data: fb.gameEnd, expect: { authors: false, shutdown: false } });
  // Early shutdowns: realized GDW hit 0 during Cycle 2 (before any world
  // formed) or Cycle 3, so the game ended with no finale at all.
  const engine = require(path.join(root, 'server', 'gameEngine'));
  const roles = require(path.join(root, 'data', 'roles.json'));
  const log = console.log;
  console.log = () => {};
  for (const [cycle, worldKey] of [[2, null], [3, 'BA']]) {
    const game = new engine.GameState({ roomCode: `SHUT${cycle}` });
    game.gameId = `e2e-end-shutdown-c${cycle}`;
    engine.NODE_IDS.forEach((n, i) => game.addPlayer(`s${i}`, `Student ${i + 1}`));
    game.assignRoles(roles);
    engine.NODE_IDS.forEach((n, i) => { game.scores[n] = (i * 2) % 3; });
    const months = cycle * 12;
    game.gdwHistory = Array.from({ length: months + 1 }, (_, m) => Math.max(0, +(25 - (m * 26) / (months - 3)).toFixed(1)));
    game.cycleMarkers = Array.from({ length: cycle }, (_, i) => ({ cycle: i + 1, index: (i + 1) * 12, policy: `Policy ${i + 1}`, policyText: `Cycle ${i + 1} policy` }));
    game.cycle = cycle;
    game.worldKey = worldKey;
    game.gdw = 0;
    game.ending = 'shutdown';
    game.startEndPhase();
    game.clearPhaseTimer();
    scenarios.push({ name: `shutdownC${cycle}`, data: game.endData, expect: { authors: false, shutdown: true } });
  }
  console.log = log;
  return scenarios;
}

async function checkScenario(page, s) {
  const problems = [];
  if (!s.data) return [`${s.name}: engine emitted no game:end`];
  if (s.expect.authors !== (s.data.finaleMode === 'writein')) problems.push(`${s.name}: unexpected finaleMode ${s.data.finaleMode}`);
  await page.evaluate((data) => {
    window.debugTriggerPhase('END', { seconds: 0, cycle: data.cyclesPlayed });
    window.debugTriggerEvent('game:end', data);
    // Skip the reveal delays: every beat on screen at once.
    document.getElementById('view-end').classList.add('beat-1', 'beat-2', 'beat-3');
  }, s.data);
  await page.waitForTimeout(3000); // let the row and beat animations finish
  const r = await page.evaluate(() => {
    const view = document.getElementById('view-end');
    const vr = view.getBoundingClientRect();
    const authorHeader = document.querySelector('#end-table th.col-author');
    const authorCells = [...document.querySelectorAll('#end-roles-body td.col-author')];
    const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const overflow = [];
    for (const el of view.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.right > window.innerWidth + 1) overflow.push(`${el.id || el.className || el.tagName} right ${Math.round(b.right)}`);
      // #view-end clips its overflow, so its own box is the visible limit.
      if (b.bottom > Math.min(window.innerHeight, vr.bottom) + 1) overflow.push(`${el.id || el.className || el.tagName} bottom ${Math.round(b.bottom)} > ${Math.round(vr.bottom)}`);
    }
    const canvas = document.getElementById('end-history-chart');
    let inked = 0;
    try {
      const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < px.length; i += 4 * 37) if (px[i] > 0) inked++;
    } catch (e) { inked = -1; }
    return {
      active: view.classList.contains('is-active'),
      shutdown: view.classList.contains('is-shutdown'),
      rows: document.querySelectorAll('#end-roles-body tr').length,
      authorHeader: visible(authorHeader),
      authorCells: authorCells.filter(visible).length,
      authorText: authorCells.map((td) => td.textContent).join('').length,
      docWidth: document.documentElement.scrollWidth,
      viewBottom: Math.round(vr.bottom),
      overflow: overflow.slice(0, 5),
      inked,
      title: document.getElementById('end-winner-title').textContent,
      revealLabel: document.getElementById('end-reveal-label').textContent
    };
  });
  if (!r.active) problems.push(`${s.name}: End Screen view not active`);
  if (r.rows !== 5) problems.push(`${s.name}: ${r.rows} role rows (want 5)`);
  if (r.shutdown !== s.expect.shutdown) problems.push(`${s.name}: is-shutdown ${r.shutdown}`);
  if (s.expect.authors) {
    if (!r.authorHeader || r.authorCells !== 5) problems.push(`${s.name}: author column missing (${r.authorCells} cells)`);
    if (!r.authorText) problems.push(`${s.name}: author column is empty`);
  } else if (r.authorHeader || r.authorCells) {
    problems.push(`${s.name}: write-in author column should be hidden`);
  }
  if (/author/i.test(r.revealLabel) !== s.expect.authors) problems.push(`${s.name}: reveal heading "${r.revealLabel}"`);
  if (r.docWidth > 1920) problems.push(`${s.name}: page ${r.docWidth}px wide`);
  if (r.overflow.length) problems.push(`${s.name}: off-screen: ${r.overflow.join('; ')}`);
  if (r.inked <= 0) problems.push(`${s.name}: GDW history chart did not draw`);
  if (!r.title) problems.push(`${s.name}: no winner / shutdown title`);
  const out = process.env.SHOT_DIR;
  if (out) await page.screenshot({ path: path.join(out, `e2e-end-${s.name}.png`) });
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.name.padEnd(10)} finale=${s.data.finaleMode} cycles=${s.data.cyclesPlayed} months=${s.data.gdwHistory.length - 1} authorCol=${r.authorHeader}`);
  return problems;
}

(async () => {
  const scenarios = await buildScenarios();
  const { server } = require(path.join(root, 'server', 'server.js'));
  const log = console.log;
  console.log = () => {};
  await new Promise((r) => server.listen(0, r));
  console.log = log;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof window.debugTriggerEvent === 'function');
  const problems = [];
  for (const s of scenarios) problems.push(...await checkScenario(page, s));
  problems.push(...errors);
  await browser.close();
  server.close();
  if (problems.length) {
    console.error('E2E END FAILED:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log(`E2E END OK: ${scenarios.length} End Screen layouts`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
