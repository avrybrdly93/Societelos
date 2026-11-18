#!/usr/bin/env node
'use strict';

// TASK-772: the Host Projector never leaks secret roles, intel, Override
// users or write-in authors before the End Screen. A projector page and 5
// phone pages play a whole game through the real server (write-in finale,
// moderation stubbed); phone 2 spends its Override in Cycle 1 and every
// phone writes a policy in Cycle 5.
//
// Until game:end arrives, every Socket.IO frame the projector receives and
// its visible text (sampled through the game) must contain:
//   - no secret field: role / roles / roleAssignment / intel / intelDrops /
//     effects / votes / override / overridesUsed / author / authors /
//     moderation / submissions / ballots / ranks / token / socketId;
//   - no finale policy carrying a node id (policy -> author link);
//   - no intel text from data/crises.json, and no student name.
// Then game:end must reveal the roles and authors (so the scan is not
// vacuous) and the End Screen must show them.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:privacy
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1.2';
delete process.env.GEMINI_API_KEY;
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:privacy needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const loom = require(path.join(__dirname, '..', 'server', 'loom'));
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));
const crises = require(path.join(__dirname, '..', 'data', 'crises.json'));

loom.moderate = async (subs) => subs.map((s, i) => ({
  node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [['artisan'], ['lotus'], ['assimilator'], ['ghost'], []][i % 5],
  effects: { purpose: 0.1, connection: 0.05 * i, health: 0.1, trust: 0, fairness: 0, autonomy: -0.05 }
}));

const NAMES = ['Zephyrine', 'Quillon', 'Marisabel', 'Thaddeus', 'Ottoline'];
const POLICIES = [
  'Every district elects a repair council that controls its own grid.',
  'A luxury dividend for every citizen, paid monthly by the Loom.',
  'Neural links for every adult so the Loom can tune mood and sleep.',
  'Switch off the Loom one night a week and hold assemblies by candlelight.',
  'Weekly shared meals in every district, with no screens allowed.'
];
const SECRET_KEYS = ['role', 'roles', 'roleAssignment', 'rolesByWorld', 'intel', 'intelDrops', 'effects', 'effectsByWorld', 'votes', 'override',
  'overridesUsed', 'author', 'authors', 'moderation', 'submissions', 'ballots', 'ranks', 'token', 'socketId'];
const INTEL = [];
for (const c of crises.crises || []) for (const t of Object.values(c.intel || {})) if (typeof t === 'string' && t.length > 20) INTEL.push(t);
const FINALE_SECONDS = { INCIDENT: 2, FINALE_WRITE: 10, FINALE_MOD: 8, FINALE_DEBATE: 3, FINALE_RANK: 10, FINALE_ENACT: 14 };

/** Problems in one decoded event payload. */
function scan(event, payload, problems) {
  const walk = (v, where, inFinale) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`, inFinale));
    if (typeof v === 'string') {
      if (NAMES.some((n) => v.includes(n))) problems.add(`${event}: student name at ${where}`);
      if (INTEL.some((t) => v.includes(t.slice(0, 40)))) problems.add(`${event}: intel text at ${where}`);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const isPolicy = typeof v.text === 'string' && POLICIES.includes(v.text);
    for (const [k, inner] of Object.entries(v)) {
      if (SECRET_KEYS.includes(k)) problems.add(`${event}: secret field "${k}" at ${where}`);
      if (isPolicy && (k === 'node' || /^NODE-0\d$/.test(String(inner)))) problems.add(`${event}: finale policy linked to ${inner} at ${where}`);
      walk(inner, `${where}.${k}`, inFinale || /finale/i.test(k));
    }
  };
  walk(payload, '$', /finale/.test(event));
}

(async () => {
  const log = console.log; console.log = () => {};
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const leaks = new Set();
  let frames = 0;
  let gameEnd = null;
  async function open(name, viewport) {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on('pageerror', (e) => errors.push(`${name} PAGEERROR: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/navigator\.vibrate/.test(m.text())) errors.push(`${name} console.error: ${m.text()}`); });
    return page;
  }

  const host = await open('host', { width: 1920, height: 1080 });
  // Every Socket.IO event the projector receives (websocket and long-poll).
  const onPacket = (raw) => {
    for (const part of String(raw).split('\x1e')) {
      const m = /^42(?:\/[^,]*,)?(\[.*\])$/s.exec(part);
      if (!m) continue;
      let msg;
      try { msg = JSON.parse(m[1]); } catch (e) { continue; }
      const [event, payload] = msg;
      frames++;
      if (event === 'game:end') { if (!gameEnd) gameEnd = payload; continue; }
      if (gameEnd) continue; // after the reveal, secrets are allowed
      scan(event, payload, leaks);
    }
  };
  host.on('websocket', (ws) => ws.on('framereceived', (f) => onPacket(f.payload)));
  host.on('response', async (r) => {
    if (r.url().includes('/socket.io/') && r.request().method() === 'GET') onPacket(await r.text().catch(() => ''));
  });
  await host.goto(`${origin}/`);
  await host.waitForFunction(() => window.SocietelosHost && window.SocietelosHost.state.roomCode);
  const game = engine.getRoom(await host.evaluate(() => window.SocietelosHost.state.roomCode));
  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 });
    await p.goto(`${origin}/mobile`);
    await p.fill('#join-name', NAMES[i]);
    await p.click('#join-submit');
    phones.push(p);
  }
  await host.waitForTimeout(800);
  await host.click('#btn-start');

  const acted = new Set();
  let finaleTimed = false;
  let samples = 0;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && game.phase !== 'END') {
    const key = `${game.cycle}:${game.phase}`;
    if (game.cycle === 5 && !finaleTimed) {
      finaleTimed = true;
      for (const [phase, s] of Object.entries(FINALE_SECONDS)) game.durations[phase] = s * 1000;
    }
    if (game.phase === 'VOTE' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p, i) => {
        const btn = i < 3 ? '#vote-a' : '#vote-b';
        if (game.cycle === 1 && i === 1) { await p.click('#override-row'); await p.click(btn); }
        await p.click(btn);
      }).map((pr) => pr.catch(() => {})));
    }
    if (game.phase === 'FINALE_WRITE' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p, i) => {
        await p.fill('#finale-text', POLICIES[i], { timeout: 4000 });
        await p.click('#finale-submit', { timeout: 2000 });
      }).map((pr) => pr.catch(() => {})));
    }
    if (game.phase === 'FINALE_RANK' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p) => {
        await p.waitForSelector('.rank-card', { timeout: 4000 });
        for (let n = 0; n < 4; n++) await p.locator('.rank-card').nth(n).click();
        await p.click('#rank-submit', { timeout: 2000 });
      }).map((pr) => pr.catch(() => {})));
    }
    if (!gameEnd) {
      const text = await host.evaluate(() => document.body.innerText).catch(() => '');
      samples++;
      if (NAMES.some((n) => text.includes(n))) leaks.add(`${key}: student name visible on the projector`);
      if (INTEL.some((t) => text.includes(t.slice(0, 40)))) leaks.add(`${key}: intel text visible on the projector`);
    }
    await host.waitForTimeout(150);
  }
  await host.waitForTimeout(2500);

  const problems = [...leaks];
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);
  if (!Object.keys(game.overridesUsed || {}).length) problems.push('no Override was spent, so the Override check proves nothing');
  if (!gameEnd) problems.push('the projector never received game:end');
  else {
    if (!(gameEnd.roles || []).every((r) => r.role)) problems.push('game:end did not reveal the roles');
    if ((gameEnd.authors || []).length !== 5 || !gameEnd.authors.every((a) => /^NODE-0\d$/.test(a.node))) problems.push('game:end did not reveal the 5 write-in authors');
  }
  const end = await host.evaluate(() => ({
    rows: document.querySelectorAll('#end-roles-body tr').length,
    text: document.getElementById('view-end').innerText
  }));
  if (end.rows !== 5) problems.push(`End Screen shows ${end.rows} role rows`);
  if (frames < 50) problems.push(`only ${frames} socket events captured from the projector`);
  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log;
  if (problems.length) {
    process.stderr.write(`E2E PRIVACY FAILED:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  process.stderr.write(`E2E PRIVACY OK: ${frames} projector socket events and ${samples} screen samples before game:end carried no secret field, no policy-author link, none of ${INTEL.length} intel texts and no student name; game:end then revealed 5 roles and 5 authors\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E PRIVACY FAILED ' + e.stack + '\n'); process.exit(1); });
