#!/usr/bin/env node
'use strict';

// TASK-773: the End Screen accurately reveals all 5 player roles, the
// write-in authors, the cycle scores, the shared grade and the winner(s).
//
// A projector page and 5 phone pages play a whole game through the real
// server (write-in finale, moderation stubbed with role tags). The script
// keeps its own record of what happened, from sources other than game:end:
//   roles    - each phone's own secret role card (#role-card data-role);
//   authors  - which phone typed which write-in;
//   scores   - recounted per cycle from the scoring rules: +1 per role
//              tagged on the winning option (Crisis 2B by world), +1 to the
//              Catalyst on a >= 10 point swing that leaves GDW above 0, and
//              in Cycle 5 +2/+1/+1 for roles on the 50/25/25 policies plus
//              +1 to the first-place author;
//   grade    - from the final GDW (60+ Thriving, 35-59 Stable, 1-34 Fragile);
//   winners  - every node tied on the top recounted total.
// It then checks the projector's End Screen (role table, author column with
// Borda rank, points, grade, final GDW, winner banner) and each phone's own
// end card (score, per-cycle breakdown, grade) against that record.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:endscreen
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1.2';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:endscreen needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const loom = require(path.join(__dirname, '..', 'server', 'loom'));
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));
const ROLES = require(path.join(__dirname, '..', 'data', 'roles.json'));

const NAMES = ['Ada', 'Bram', 'Cleo', 'Dev', 'Esme'];
const POLICIES = [
  'Every district elects a repair council that controls its own grid.',
  'A luxury dividend for every citizen, paid monthly by the Loom.',
  'Neural links for every adult so the Loom can tune mood and sleep.',
  'Switch off the Loom one night a week and hold assemblies by candlelight.',
  'Weekly shared meals in every district, with no screens allowed.'
];
// Stubbed moderation tags by author slot (what the Loom "read" into each write-in).
const TAGS = [['artisan'], ['lotus'], ['assimilator', 'lotus'], ['ghost'], ['artisan', 'ghost']];
loom.moderate = async (subs) => subs.map((s) => {
  const i = POLICIES.indexOf(s.text);
  return { node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: TAGS[i] || [], effects: { purpose: 0.15, connection: 0.1, health: 0.05, trust: 0, fairness: 0.05, autonomy: -0.05 } };
});
const VOTES = { 1: 'BBABA', 2: 'ABBAB', 3: 'AABBA', 4: 'BABAB' };
const FINALE_SECONDS = { INCIDENT: 2, FINALE_WRITE: 10, FINALE_MOD: 8, FINALE_DEBATE: 3, FINALE_RANK: 10, FINALE_ENACT: 14 };
const gradeFor = (g) => (!(g > 0) ? 'SHUTDOWN' : g >= 60 ? 'Thriving' : g >= 35 ? 'Stable' : 'Fragile');

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
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 }, `${origin}/mobile`);
    await p.fill('#join-name', NAMES[i]);
    await p.click('#join-submit');
    phones.push(p);
  }
  await Promise.all(phones.map((p) => p.waitForFunction(() => (JSON.parse(sessionStorage.getItem('societelos.session') || '{}') || {}).node, null, { timeout: 5000 })));
  const nodes = await Promise.all(phones.map((p) => p.evaluate(() => JSON.parse(sessionStorage.getItem('societelos.session')).node)));
  await host.waitForTimeout(500);

  // The script's own record.
  const roleOf = {}; // node -> role key, from the phone's role card
  const cycles = []; // { cycle, tags, previousGdw, gdw, winner }
  let firstVote = null;
  game.on('resolution', (r) => {
    const res = r.result || {};
    if (res.finale) { cycles.push({ cycle: res.cycle, finale: true, previousGdw: res.previousGdw, gdw: r.gdw, enacted: res.enacted }); return; }
    // Winning option tags, read from the crisis data as the room loaded it (Crisis 2B depends on Cycle 1's vote).
    const option = game.crisis.options[res.winner];
    if (res.cycle === 1) firstVote = res.winner;
    const tags = (option.rolesByWorld && option.rolesByWorld[firstVote]) || option.roles || [];
    cycles.push({ cycle: res.cycle, tags, previousGdw: res.previousGdw, gdw: r.gdw, winner: res.winner });
  });
  await host.click('#btn-start');

  const acted = new Set();
  let finaleTimed = false;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && game.phase !== 'END') {
    const key = `${game.cycle}:${game.phase}`;
    if (game.cycle === 5 && !finaleTimed) {
      finaleTimed = true;
      for (const [phase, s] of Object.entries(FINALE_SECONDS)) game.durations[phase] = s * 1000;
    }
    if (game.phase === 'ROLE_ASSIGN' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p, i) => {
        await p.waitForFunction(() => document.getElementById('role-card').dataset.role, null, { timeout: 4000 });
        roleOf[nodes[i]] = await p.evaluate(() => document.getElementById('role-card').dataset.role);
      }).map((pr) => pr.catch((e) => problems.push(`role card: ${e.message.split('\n')[0]}`))));
    }
    if (game.phase === 'VOTE' && !acted.has(key)) {
      acted.add(key);
      const v = VOTES[game.cycle] || 'AAABB';
      await Promise.all(phones.map((p, i) => p.click(v[i] === 'A' ? '#vote-a' : '#vote-b', { timeout: 3000 }).catch(() => {})));
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
    await host.waitForTimeout(150);
  }
  // Let all three End Screen beats land (0 / 15 / 25 s on real timers).
  await host.evaluate(() => document.getElementById('view-end').classList.add('beat-1', 'beat-2', 'beat-3'));
  await host.waitForTimeout(2000);
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);

  // --- Recount ---------------------------------------------------------
  const authorOf = {}; // policy id -> node, via which phone typed the text
  const tagsOf = {};
  for (const p of (game.finale && game.finale.policies) || []) {
    const i = POLICIES.indexOf(p.text);
    authorOf[p.id] = nodes[i];
    tagsOf[p.id] = TAGS[i];
  }
  const points = {};
  for (const ids of Object.values((game.finale && game.finale.ranks) || {})) ids.forEach((id, i) => { points[id] = (points[id] || 0) + [4, 3, 2, 1][i]; });
  const expected = Object.fromEntries(nodes.map((n) => [n, { total: 0, perCycle: [] }]));
  const catalystSwing = (a, b) => Math.round(Math.abs(b - a) * 10) / 10 >= 10 && b > 0;
  for (const c of cycles) {
    for (const n of nodes) {
      const row = { cycle: c.cycle, role: 0, catalyst: 0, author: 0 };
      if (c.finale) {
        for (const e of c.enacted || []) if ((tagsOf[e.id] || []).includes(roleOf[n])) row.role += { first: 2, second: 1, third: 1 }[e.place] || 0;
        const first = (c.enacted || []).find((e) => e.place === 'first');
        if (first && authorOf[first.id] === n) row.author = 1;
      } else if (c.tags.includes(roleOf[n])) row.role = 1;
      if (roleOf[n] === 'catalyst' && catalystSwing(c.previousGdw, c.gdw)) row.catalyst = 1;
      expected[n].perCycle.push(row);
      expected[n].total += row.role + row.catalyst + row.author;
    }
  }
  const finalGdw = cycles.length ? cycles.at(-1).gdw : NaN;
  const grade = gradeFor(finalGdw);
  const top = Math.max(...nodes.map((n) => expected[n].total));
  const winners = nodes.filter((n) => expected[n].total === top).sort();
  const roleName = (k) => (ROLES.find((r) => r.id === k || r.key === k) || {}).name || k;
  if (cycles.length !== 5) problems.push(`recorded ${cycles.length} resolutions`);
  if (Object.keys(roleOf).length !== 5 || new Set(Object.values(roleOf)).size !== 5) problems.push(`phones showed roles ${JSON.stringify(roleOf)}`);

  // --- Projector End Screen ---------------------------------------------
  const screen = await host.evaluate(() => ({
    rows: [...document.querySelectorAll('#end-roles-body tr')].map((tr) => ({ node: tr.dataset.node, cells: [...tr.children].map((td) => td.textContent.trim()), winner: tr.classList.contains('is-winner') })),
    grade: document.getElementById('end-grade').textContent.trim(),
    finalGdw: document.getElementById('end-final-gdw').textContent.trim(),
    title: document.getElementById('end-winner-title').textContent.trim(),
    label: document.getElementById('end-winner-label').textContent.trim()
  }));
  if (screen.rows.length !== 5) problems.push(`End Screen has ${screen.rows.length} rows`);
  for (const r of screen.rows) {
    const [node, name, role, policy, total] = r.cells;
    const i = nodes.indexOf(r.node);
    if (i < 0) { problems.push(`End Screen row for unknown node ${r.node}`); continue; }
    if (node !== r.node || name !== NAMES[i]) problems.push(`${r.node}: row shows "${node}" / "${name}", want ${NAMES[i]}`);
    if (role !== roleName(roleOf[r.node])) problems.push(`${r.node}: role "${role}", the phone's card said ${roleName(roleOf[r.node])}`);
    const pid = Object.keys(authorOf).find((id) => authorOf[id] === r.node);
    if (!pid || !policy.includes(POLICIES[i])) problems.push(`${r.node}: author column "${policy.slice(0, 60)}" lacks the policy this phone wrote`);
    else if (!policy.includes(`${points[pid] || 0} BORDA PTS`)) problems.push(`${r.node}: author column "${policy}" vs recounted ${points[pid] || 0} Borda points`);
    if (Number(total) !== expected[r.node].total) problems.push(`${r.node}: ${total} points on screen, recount ${expected[r.node].total}`);
    if (r.winner !== winners.includes(r.node)) problems.push(`${r.node}: winner highlight ${r.winner}`);
  }
  const gradeLabel = { SHUTDOWN: 'SHUTDOWN', Fragile: 'FRAGILE', Stable: 'STABLE', Thriving: 'THRIVING' }[grade];
  if (screen.grade !== gradeLabel) problems.push(`grade "${screen.grade}", final GDW ${finalGdw} means ${gradeLabel}`);
  if (screen.finalGdw !== `FINAL GDW ${finalGdw.toFixed(1)}%`) problems.push(`"${screen.finalGdw}" vs final GDW ${finalGdw}`);
  for (const n of winners) if (!screen.title.includes(NAMES[nodes.indexOf(n)]) || !screen.title.includes(n)) problems.push(`winner banner "${screen.title}" lacks ${NAMES[nodes.indexOf(n)]} (${n})`);
  for (const n of nodes) if (!winners.includes(n) && screen.title.includes(n)) problems.push(`winner banner names non-winner ${n}`);
  if ((winners.length > 1) !== /shared/i.test(screen.label)) problems.push(`banner label "${screen.label}" for ${winners.length} winner(s)`);

  // --- Each phone's own end card ------------------------------------------
  for (const [i, p] of phones.entries()) {
    const n = nodes[i];
    const card = await p.evaluate(() => ({
      score: document.getElementById('end-score').textContent.trim(),
      lines: [...document.querySelectorAll('#end-breakdown li')].map((li) => li.textContent.trim()),
      grade: document.getElementById('end-grade').textContent.trim(),
      outcome: document.getElementById('end-outcome').textContent.trim()
    }));
    if (Number(card.score) !== expected[n].total) problems.push(`phone${i + 1}: score ${card.score}, recount ${expected[n].total}`);
    const want = expected[n].perCycle.map((c) => {
      const parts = [];
      if (c.role) parts.push(`+${c.role} role`);
      if (c.catalyst) parts.push(`+${c.catalyst} catalyst`);
      if (c.author) parts.push(`+${c.author} author`);
      return `CYCLE ${c.cycle}: ${parts.length ? parts.join(', ') : '0'}`;
    });
    if (card.lines.join(' | ') !== want.join(' | ')) problems.push(`phone${i + 1}: breakdown "${card.lines.join(' | ')}", recount "${want.join(' | ')}"`);
    if (card.grade !== gradeLabel) problems.push(`phone${i + 1}: grade ${card.grade}`);
    const won = winners.includes(n);
    if (won !== /WON|SHARED VICTORY/.test(card.outcome)) problems.push(`phone${i + 1}: outcome "${card.outcome}" (winner: ${won})`);
  }

  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  if (problems.length) {
    process.stderr.write(`E2E ENDSCREEN FAILED:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  process.stderr.write(`E2E ENDSCREEN OK: projector and phones match an independent recount: roles ${nodes.map((n) => `${n}=${roleOf[n]}`).join(' ')}; totals ${nodes.map((n) => expected[n].total).join('/')}; grade ${grade} at GDW ${finalGdw}; winner(s) ${winners.join(' & ')}; 5 authors with Borda points\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E ENDSCREEN FAILED ' + e.stack + '\n'); process.exit(1); });
