#!/usr/bin/env node
'use strict';

// TASK-764 / TASK-765: Full End-to-End Tie-Breaker Tests (#10, #11). A
// projector page and 5 phone pages play one whole game through the real
// server, with every vote, Override and ranking made by tapping the phones.
//
// Test #10 (Cycle 2): phone 1 spends its Override and votes A with phone 2;
// phones 3-5 vote B, so the weighted vote is 3-3. The Loom must pick the
// option whose forecast median GDW ends higher (checked against the
// engine's own cached forecasts), the resolution must be flagged as a tie,
// and the projector shows "TIE // LOOM CHOSE HIGHER FORECAST" without
// revealing who spent the Override.
//
// Test #11 (Cycle 5): the five phones rank their ballots so the Borda tally
// needs every tie-break level: two policies on 13 points with identical
// 1st/2nd/3rd/4th places (decided by forecast median), and three on 8
// points decided by 1st places (one has a 1st) and then 2nd places. The
// finale order and the 50/25/25 package must follow that chain.
//
// The Loom's moderation is stubbed (every write-in accepted with distinct
// effects) so no Gemini key is needed.
//   npm run e2e:tiebreak   (needs Playwright with Chromium)
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1.2';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:tiebreak needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const loom = require(path.join(__dirname, '..', 'server', 'loom'));
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

// Distinct, mild effect vectors so the single-policy forecast medians differ.
const EFFECTS = [
  { purpose: 0.3, connection: 0.1, health: 0, trust: 0, fairness: 0.1, autonomy: 0 },
  { purpose: 0, connection: 0, health: 0.4, trust: 0.2, fairness: 0, autonomy: -0.1 },
  { purpose: -0.2, connection: 0.2, health: 0.1, trust: 0, fairness: 0, autonomy: 0.1 },
  { purpose: 0.1, connection: -0.1, health: -0.2, trust: 0.1, fairness: 0.2, autonomy: 0.1 },
  { purpose: 0, connection: 0.3, health: 0, trust: -0.2, fairness: 0.1, autonomy: 0.2 }
];
loom.moderate = async (subs) => subs.map((s) => {
  const i = Number(String(s.node).slice(-1)) - 1;
  return { node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [['artisan'], ['lotus'], ['assimilator'], ['ghost'], ['lotus']][i], effects: EFFECTS[i] };
});
const POLICIES = [
  'Every district elects a repair council that controls its own grid.',
  'Free clinics in every district, run by the Loom around the clock.',
  'Neighbourhood festivals every month, planned by the citizens.',
  'Citizen juries audit the Loom budget and publish what they find.',
  'Weekly shared meals in every district, with no screens allowed.'
];
// Rankings over P1..P5 (Pk = the k-th finale policy; ballot Nk excludes Pk).
// Tally: P2 13 [2,1,1,0], P4 13 [2,1,1,0], P1 8 [1,0,1,2], P5 8 [0,2,0,2], P3 8 [0,1,2,1].
const PLAN = [
  ['P4', 'P5', 'P2', 'P3'],
  ['P1', 'P3', 'P4', 'P5'],
  ['P4', 'P2', 'P1', 'P5'],
  ['P2', 'P5', 'P3', 'P1'],
  ['P2', 'P4', 'P3', 'P1']
];
const FINALE_SECONDS = { INCIDENT: 2, FINALE_WRITE: 10, FINALE_MOD: 8, FINALE_DEBATE: 3, FINALE_RANK: 12, FINALE_ENACT: 14 };

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
  const game = engine.getRoom(await host.evaluate(() => window.SocietelosHost.state.roomCode));
  const resolutions = [];
  game.on('resolution', (r) => resolutions.push(r.result || r));
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 }, `${origin}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await Promise.all(phones.map((p) => p.waitForFunction(() => (JSON.parse(sessionStorage.getItem('societelos.session') || '{}') || {}).node, null, { timeout: 5000 })));
  const nodes = await Promise.all(phones.map((p) => p.evaluate(() => JSON.parse(sessionStorage.getItem('societelos.session')).node)));
  await host.waitForTimeout(500);
  await host.click('#btn-start');

  const acted = new Set();
  let medians2 = null;
  let tieView = null;
  let finaleTimed = false;
  let plan = null;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && game.phase !== 'END') {
    const key = `${game.cycle}:${game.phase}`;
    if (game.cycle === 5 && !finaleTimed) {
      finaleTimed = true;
      for (const [phase, s] of Object.entries(FINALE_SECONDS)) game.durations[phase] = s * 1000;
    }
    if (game.phase === 'VOTE' && !acted.has(key)) {
      acted.add(key);
      if (game.cycle === 2) {
        // The engine's own cached forecasts, the ones the tie-break will use.
        medians2 = { A: engine.forecastMedianEnd(game.runSimulation('A')), B: engine.forecastMedianEnd(game.runSimulation('B')) };
        await phones[0].waitForSelector('#m-view-vote.is-active #vote-panel', { timeout: 4000 }).then(() => phones[0].click('#override-row', { timeout: 3000 })).catch((e) => problems.push(`override: ${e.message.split('\n')[0]}`));
      }
      await Promise.all(phones.map(async (p, i) => {
        const btn = (game.cycle === 2 ? i < 2 : i < 3) ? '#vote-a' : '#vote-b';
        await p.click(btn, { timeout: 3000 });
        // An armed Override asks for a confirming second tap on the same button.
        if (game.cycle === 2 && i === 0) await p.click(btn, { timeout: 3000 });
      }).map((pr) => pr.catch(() => {})));
    }
    if (game.cycle === 2 && game.phase === 'RESOLUTION' && !tieView) {
      await host.waitForSelector('#badge-tie:not([hidden])', { timeout: 6000 }).catch(() => {});
      tieView = await host.evaluate(() => ({
        badge: !document.getElementById('badge-tie').hidden,
        text: document.body.innerText
      }));
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
      // Pk -> the k-th finale policy; ballot k belongs to that policy's author.
      const pol = game.finale.policies;
      const idOf = (pk) => pol[Number(pk.slice(1)) - 1].id;
      plan = Object.fromEntries(pol.map((p, k) => [p.node, PLAN[k].map(idOf)]));
      await Promise.all(phones.map(async (p, i) => {
        await p.waitForSelector('.rank-card', { timeout: 4000 });
        for (const id of plan[nodes[i]]) await p.click(`.rank-card[data-policy="${id}"]`, { timeout: 2000 });
        await p.click('#rank-submit', { timeout: 2000 });
      }).map((pr) => pr.catch((e) => problems.push(`rank: ${e.message.split('\n')[0]}`))));
    }
    await host.waitForTimeout(150);
  }
  await host.waitForTimeout(1500);
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);

  // --- Test #10: Cycle 2 Override tie ---
  const r2 = resolutions.find((r) => r.cycle === 2);
  if (!r2) problems.push(`no Cycle 2 resolution (got cycles ${resolutions.map((r) => r.cycle).join(',')})`);
  else {
    if (!r2.tie || r2.totals.A !== 3 || r2.totals.B !== 3) problems.push(`Cycle 2 totals ${JSON.stringify(r2.totals)} tie ${r2.tie} (want 3-3 tie)`);
    const want = medians2 && (medians2.B - medians2.A > 1e-9 ? 'B' : 'A');
    if (r2.winner !== want) problems.push(`Cycle 2 tie went to ${r2.winner}; forecast medians A ${medians2 && medians2.A} B ${medians2 && medians2.B}`);
    if (game.voteHistory[2] !== want) problems.push(`voteHistory[2] ${game.voteHistory[2]}`);
  }
  if (!tieView || !tieView.badge) problems.push('projector did not show the tie badge');
  if (tieView && /override/i.test(tieView.text) && /NODE-0\d.*override|override.*NODE-0\d|Student\d.*override/i.test(tieView.text)) problems.push('projector text links a player to the Override');
  if (r2 && JSON.stringify(r2).match(/overrideBy|overrideNode|override":\s*"NODE/)) problems.push('resolution payload names the Override user');

  // --- Test #11: Borda tie-break chain ---
  const finale = game.finale || {};
  const pol = finale.policies || [];
  const P = (k) => pol[k - 1] && pol[k - 1].id;
  const rows = finale.rows || [];
  const got = rows.map((r) => `${r.id}:${r.points}[${r.places.join('')}]`);
  const tally = Object.fromEntries(rows.map((r) => [r.id, r]));
  const expectTally = { 1: [8, '1012'], 2: [13, '2110'], 3: [8, '0121'], 4: [13, '2110'], 5: [8, '0202'] };
  for (const [k, [pts, places]] of Object.entries(expectTally)) {
    const t = tally[P(Number(k))];
    if (!t || t.points !== pts || t.places.join('') !== places) problems.push(`P${k}: ${t ? `${t.points} [${t.places.join('')}]` : 'missing'}, planned ${pts} [${places}]`);
  }
  const m2 = game.finaleMedianOf(P(2));
  const m4 = game.finaleMedianOf(P(4));
  const top = m2 > m4 ? [P(2), P(4)] : m4 > m2 ? [P(4), P(2)] : [P(2), P(4)].sort();
  const expectOrder = [...top, P(1), P(5), P(3)];
  if (rows.map((r) => r.id).join(' ') !== expectOrder.join(' ')) problems.push(`Borda order ${got.join(' ')}; expected ${expectOrder.join(' ')} (medians P2 ${m2}, P4 ${m4})`);
  const enacted = (finale.enacted || []).map((e) => `${e.id}@${e.weight}`);
  const expectEnacted = [`${expectOrder[0]}@0.5`, `${expectOrder[1]}@0.25`, `${expectOrder[2]}@0.25`];
  if (enacted.join(' ') !== expectEnacted.join(' ')) problems.push(`enacted ${enacted.join(' ')}; expected ${expectEnacted.join(' ')}`);
  if (m2 === m4) problems.push('P2 and P4 forecast medians are equal, so the median level was not exercised');

  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  if (problems.length) {
    process.stderr.write(`E2E TIEBREAK FAILED:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  process.stderr.write(`E2E TIEBREAK OK: Cycle 2 Override 3-3 tie -> ${r2.winner} (forecast medians A ${medians2.A.toFixed(1)}, B ${medians2.B.toFixed(1)}), tie badge on the projector; Cycle 5 Borda ${got.join(' ')} -> enacted ${enacted.join(', ')} (13-point tie on median ${Math.max(m2, m4).toFixed(2)} vs ${Math.min(m2, m4).toFixed(2)}; 8-point ties on 1st then 2nd places)\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E TIEBREAK FAILED ' + e.stack + '\n'); process.exit(1); });
