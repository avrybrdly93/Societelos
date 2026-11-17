#!/usr/bin/env node
'use strict';

// Live Cycles 1-5 in the browser: a projector page and 5 phone pages join a
// real game, play Cycles 1-4 on fast timers, then run the write-and-rank
// finale FINALE_WRITE -> FINALE_MOD -> FINALE_DEBATE -> FINALE_RANK ->
// FINALE_ENACT -> END on longer timers, with the Loom's moderation stubbed
// (no Gemini key needed). From the intro on, every 100 ms it samples which
// screen the projector and each phone show, and fails on a page error, a screen that does not
// match the phase, or a flash of an unrelated screen mid-transition.
//
// With FALLBACK=1 the stubbed moderation fails instead, and the finale must
// fall back to the authored A/B DEBATE -> VOTE -> RESOLUTION -> END.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:finale-flow          FALLBACK=1 npm run e2e:finale-flow

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1.2';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:finale-flow needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const loom = require(path.join(__dirname, '..', 'server', 'loom'));
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

const FALLBACK = process.env.FALLBACK === '1';
// Moderation stub: every write-in accepted with a small, distinct effect
// vector, or (FALLBACK=1) a Gemini timeout, which the engine treats as failure.
loom.moderate = async (subs) => {
  await new Promise((r) => setTimeout(r, 1500)); // Gemini-like latency
  if (FALLBACK) throw new Error('simulated Gemini timeout');
  return subs.map((s, i) => ({
    node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [['artisan'], ['lotus'], ['assimilator'], ['ghost'], []][i % 5],
    effects: { purpose: 0.05 * (i + 1), connection: 0.02, health: 0, trust: -0.02 * i, fairness: 0.03, autonomy: 0 }
  }));
};

// Seconds per finale phase (cycles 1-4 keep FAST_TIMER_SECONDS).
const FINALE_SECONDS = { INCIDENT: 2, FINALE_WRITE: 8, FINALE_MOD: 6, FINALE_DEBATE: 3, FINALE_RANK: 8, FINALE_ENACT: 14, DEBATE: 3, VOTE: 6, RESOLUTION: 14 };

// Screens each phase may show (a transition may pass through the previous
// phase's screen for a frame, which is fine; anything else is a flash).
const HOST_VIEWS = {
  INTRO: ['view-intro'], ROLE_ASSIGN: ['view-roles'], CHAMBER: ['view-chamber'], INTEL: ['view-chamber'], WORLD_REVEAL: ['view-world'],
  INCIDENT: ['view-chamber'], FINALE_WRITE: ['view-chamber'], FINALE_MOD: ['view-chamber'],
  FINALE_DEBATE: ['view-finale'], FINALE_RANK: ['view-finale'], FINALE_ENACT: ['view-enact', 'view-chamber'],
  DEBATE: ['view-chamber'], VOTE: ['view-chamber'], RESOLUTION: ['view-chamber'], END: ['view-end']
};
const PHONE_VIEWS = {
  INTRO: ['m-view-wait'], ROLE_ASSIGN: ['m-view-role'], CHAMBER: ['m-view-wait'], INTEL: ['m-view-intel'], WORLD_REVEAL: ['m-view-world'],
  INCIDENT: ['m-view-wait'], FINALE_WRITE: ['m-view-finale-write', 'm-view-finale-wait'], FINALE_MOD: ['m-view-finale-wait'],
  FINALE_DEBATE: ['m-view-wait'], FINALE_RANK: ['m-view-finale-rank'], FINALE_ENACT: ['m-view-wait'],
  DEBATE: ['m-view-debate'], VOTE: ['m-view-vote'], RESOLUTION: ['m-view-result'], END: ['m-view-wait', 'm-view-end']
};
const POLICIES = [
  'Every district elects a repair council that controls its own grid.',
  'A luxury dividend for every citizen, paid monthly by the Loom.',
  'Neural links for every adult so the Loom can tune mood and sleep.',
  'Shut the servers one day a week so people relearn how to live.',
  'Keep current protocols while a citizens’ assembly reviews the Loom.'
];

(async () => {
  const log = console.log;
  console.log = () => {};
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, name) => page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  const host = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(host, 'host');
  await host.goto(`${base}/`);
  await host.waitForTimeout(500);
  const game = engine.getLatestRoom();
  game.gameId = 'e2efinale001';
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    watch(p, `phone${i + 1}`);
    await p.goto(`${base}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await host.waitForTimeout(800);
  await host.click('#btn-start');

  const viewOf = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).id || null, sel).catch(() => null);
  const problems = [];
  const sequence = [];
  let lastKey = null;
  let finaleTimed = false;
  const acted = new Set();
  const fallbackSeen = { host: false, phones: false, options: false };
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && game.phase !== 'END') {
    const key = `${game.cycle}:${game.phase}`;
    if (key !== lastKey) { sequence.push(key); lastKey = key; }
    if (game.cycle === 5 && !finaleTimed) {
      finaleTimed = true;
      for (const [phase, s] of Object.entries(FINALE_SECONDS)) game.durations[phase] = s * 1000;
    }
    // Cycles 1-4 and the fallback vote: tap a side on every phone.
    if (game.phase === 'VOTE' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map((p, i) => p.click(game.cycle === 2 || i >= 3 ? '#vote-b' : '#vote-a', { timeout: 3000 }).catch(() => {})));
    }
    if (game.phase === 'FINALE_WRITE' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p, i) => {
        await p.fill('#finale-text', POLICIES[i], { timeout: 4000 });
        await p.click('#finale-submit', { timeout: 2000 });
      }).map((pr) => pr.catch((e) => problems.push(`write: ${e.message.split('\n')[0]}`))));
    }
    if (game.phase === 'FINALE_RANK' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p, i) => {
        await p.waitForSelector('.rank-card', { timeout: 4000 });
        const order = [[0, 1, 2, 3], [3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1], [0, 2, 1, 3]][i];
        for (const n of order) await p.locator('.rank-card').nth(n).click();
        await p.click('#rank-submit', { timeout: 2000 });
      }).map((pr) => pr.catch((e) => problems.push(`rank: ${e.message.split('\n')[0]}`))));
    }
    // Sample the screens through all five cycles (from the intro on).
    if (game.phase !== 'LOBBY') {
      const phase = game.phase;
      const hv = await viewOf(host, '#host-main > .view.is-active');
      const pv = await Promise.all(phones.map((p) => viewOf(p, '#m-main > .m-view.is-active')));
      const settled = game.phase === phase;
      if (settled && HOST_VIEWS[phase] && !HOST_VIEWS[phase].includes(hv)) problems.push(`host on ${hv} during ${phase}`);
      pv.forEach((v, i) => { if (settled && PHONE_VIEWS[phase] && !PHONE_VIEWS[phase].includes(v)) problems.push(`phone${i + 1} on ${v} during ${phase}`); });
      // Fallback debate: projector and phones say why the A/B options are back.
      if (phase === 'DEBATE' && settled) {
        const shown = (page, sel) => page.evaluate((x) => { const e = document.querySelector(x); return !!e && !e.hidden; }, sel).catch(() => false);
        fallbackSeen.host = fallbackSeen.host || await shown(host, '#finale-fallback-notice');
        fallbackSeen.phones = fallbackSeen.phones || (await Promise.all(phones.map((p) => shown(p, '#m-finale-fallback')))).every(Boolean);
        fallbackSeen.options = fallbackSeen.options || await shown(host, '#policy-panel');
      }
    }
    await host.waitForTimeout(100);
  }
  // A frame or two behind the server right after a transition is expected;
  // report a screen only if it was wrong in 3+ samples.
  const counts = {};
  problems.forEach((p) => { counts[p] = (counts[p] || 0) + 1; });
  const real = Object.entries(counts).filter(([p, n]) => n >= 3 || /^(write|rank):/.test(p)).map(([p, n]) => `${p} (x${n})`);
  const finale = sequence.filter((k) => k.startsWith('5:')).map((k) => k.slice(2));
  for (const c of [1, 2, 3, 4]) {
    for (const ph of ['INCIDENT', 'INTEL', 'DEBATE', 'VOTE', 'RESOLUTION']) if (!sequence.includes(`${c}:${ph}`)) real.push(`missing ${c}:${ph}`);
  }
  if (!sequence.includes('2:WORLD_REVEAL')) real.push('missing 2:WORLD_REVEAL');
  const expected = FALLBACK ? ['INCIDENT', 'FINALE_WRITE', 'FINALE_MOD', 'DEBATE', 'VOTE', 'RESOLUTION'] : ['INCIDENT', 'FINALE_WRITE', 'FINALE_MOD', 'FINALE_DEBATE', 'FINALE_RANK', 'FINALE_ENACT'];
  if (finale.join(' ') !== expected.join(' ')) real.push(`finale ran ${finale.join(' -> ')}; expected ${expected.join(' -> ')}`);
  if (game.phase !== 'END') real.push(`game stopped at ${game.cycle}:${game.phase}`);
  if (FALLBACK && !(fallbackSeen.host && fallbackSeen.phones && fallbackSeen.options)) real.push(`fallback debate not explained on screen: ${JSON.stringify(fallbackSeen)}`);
  if (FALLBACK && game.voteHistory[5] !== 'A' && game.voteHistory[5] !== 'B') real.push(`fallback vote did not resolve A/B: ${JSON.stringify(game.voteHistory)}`);
  if (!FALLBACK && !(game.finale && game.finale.enacted && game.finale.enacted.length === 3)) real.push('no 50/25/25 package enacted');
  real.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  console.log(`phases: ${sequence.join(' ')}`);
  console.log(`world ${game.worldKey}; finale: ${finale.join(' -> ')} -> ${game.phase}; GDW ${game.gdw}`);
  if (real.length) {
    console.error(`E2E FINALE FLOW FAILED:\n${real.join('\n')}`);
    process.exit(1);
  }
  console.log(`E2E FINALE FLOW OK${FALLBACK ? ' (Gemini fallback to A/B)' : ''}: every screen matched its phase, clean console`);
  process.exit(0);
})().catch((e) => { console.error(`E2E FINALE FLOW FAILED ${e.stack}`); process.exit(1); });
