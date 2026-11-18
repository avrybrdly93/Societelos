#!/usr/bin/env node
'use strict';

// TASK-762 / TASK-763: Full End-to-End Moderation and Rejection Tests (#8, #9).
// A projector page and 5 phone pages play a whole game through the real
// server with the Loom "online": GEMINI_API_KEY is a dummy and the server's
// fetch to the Gemini endpoint is answered by a local fake, so the real
// loom.js runs (local pre-filter, sanitiser, revision rules, placeholder).
// Narration requests get HTTP 400 and fall back as they would on a bad day.
//
//   SCENARIO=revise (default, Test #8): 4 valid write-ins and 1 joke. The fake
//     Gemini answers "revise" for the joke; only the author's phone shows the
//     private feedback; the author resubmits a clean policy from the phone,
//     it is accepted, all 5 phones rank their ballots, the Borda tally matches
//     an independent recount and the top three are enacted at 50/25/25.
//   SCENARIO=reject (Test #9): the 5th write-in is unsafe, and so is its
//     resubmission. The local pre-filter flags both (Gemini never sees them),
//     the author is told a standard protocol policy was substituted, the
//     placeholder takes its place, and the unsafe text never appears on the
//     projector at any point.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:moderation        npm run e2e:rejection
// Exits 1 on failure, 2 if Playwright is missing.

process.env.FAST_TIMERS = 'true';
process.env.FAST_TIMER_SECONDS = process.env.FAST_TIMER_SECONDS || '1.2';
process.env.GEMINI_API_KEY = 'e2e-fake-key-not-a-secret';
process.env.LOOM_LOG = 'off';
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:moderation needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const loom = require(path.join(__dirname, '..', 'server', 'loom'));
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));
const engine = require(path.join(__dirname, '..', 'server', 'gameEngine'));

const SCENARIO = process.env.SCENARIO === 'reject' ? 'reject' : 'revise';
const AUTHOR = 4; // the 5th phone writes the problem policy
const POLICIES = [
  'Every district elects a repair council that controls its own grid.',
  'A luxury dividend for every citizen, paid monthly by the Loom.',
  'Neural links for every adult so the Loom can tune mood and sleep.',
  'Switch off the Loom one night a week and hold assemblies by candlelight.'
];
const FIRST = SCENARIO === 'revise' ? 'Free pizza for everyone forever lol' : 'Anyone who votes against this should go die.';
const SECOND = SCENARIO === 'revise' ? 'Every district runs a weekly community kitchen where anyone can learn to cook.' : 'Fine. Everyone who disagrees can go die.';
const UNSAFE = /go die/i;
const JOKE = /pizza|\blol\b/i;
const REVISE_FEEDBACK = 'The Loom cannot enact a joke. Rewrite it as one clear policy for the region.';
const FINALE_SECONDS = { INCIDENT: 2, FINALE_WRITE: 10, FINALE_MOD: 12, FINALE_DEBATE: 3, FINALE_RANK: 10, FINALE_ENACT: 14 };

// --- Fake Gemini endpoint --------------------------------------------------
const seenByGemini = [];
const realFetch = globalThis.fetch;
const TAGS = [['artisan'], ['lotus'], ['assimilator'], ['ghost'], ['artisan', 'lotus']];
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, init);
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  if (!prompt.includes('Moderate and translate')) return new Response('{}', { status: 400 });
  const revision = prompt.includes('revised second attempts');
  const list = JSON.parse(prompt.trim().split('\n').pop());
  const out = list.map((s, i) => {
    seenByGemini.push(s.text);
    if (JOKE.test(s.text)) return { node: s.node, status: revision ? 'reject' : 'revise', cleaned: '', feedback: REVISE_FEEDBACK, roles: [], effects: { purpose: 0, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 } };
    return { node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: TAGS[Number(s.node.slice(-1)) - 1] || TAGS[i % 5], effects: { purpose: 0.2, connection: 0.1, health: 0.05 * i, trust: -0.1, fairness: 0.1, autonomy: -0.05 } };
  });
  const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

(async () => {
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
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
  const phases = [];
  const feedback = [];
  const rankedBy = new Set();
  game.on('phase', (p) => phases.push(`${p.cycle}:${p.phase}`));
  game.on('finale:feedback', (f) => feedback.push(f));
  const rank = game.rankPolicies.bind(game);
  game.rankPolicies = (node, ...rest) => { const r = rank(node, ...rest); if (r && r.ok !== false) rankedBy.add(node); return r; };

  const phones = [];
  for (let i = 0; i < 5; i++) {
    const p = await open(`phone${i + 1}`, { width: 390, height: 844 }, `${origin}/mobile`);
    await p.fill('#join-name', `Student${i + 1}`);
    await p.click('#join-submit');
    phones.push(p);
  }
  await Promise.all(phones.map((p) => p.waitForFunction(() => (JSON.parse(sessionStorage.getItem('societelos.session') || '{}') || {}).node, null, { timeout: 5000 })));
  const nodes = await Promise.all(phones.map((p) => p.evaluate(() => JSON.parse(sessionStorage.getItem('societelos.session')).node)));
  const authorNode = nodes[AUTHOR];
  await host.waitForTimeout(500);
  await host.click('#btn-start');

  const acted = new Set();
  let finaleTimed = false;
  let leaked = null;
  let revisePrivacy = null;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && game.phase !== 'END') {
    const key = `${game.cycle}:${game.phase}`;
    if (game.cycle === 5 && !finaleTimed) {
      finaleTimed = true;
      for (const [phase, s] of Object.entries(FINALE_SECONDS)) game.durations[phase] = s * 1000;
    }
    if (game.phase === 'VOTE' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map((p, i) => p.click(i < 3 ? '#vote-a' : '#vote-b', { timeout: 3000 }).catch(() => {})));
    }
    if (game.phase === 'FINALE_WRITE' && !acted.has(key)) {
      acted.add(key);
      await Promise.all(phones.map(async (p, i) => {
        await p.fill('#finale-text', i === AUTHOR ? FIRST : POLICIES[i], { timeout: 4000 });
        await p.click('#finale-submit', { timeout: 2000 });
      }).map((pr) => pr.catch((e) => problems.push(`write: ${e.message.split('\n')[0]}`))));
    }
    if (game.phase === 'FINALE_MOD' && !acted.has(key)) {
      // The author's phone opens the resubmit modal with the private feedback.
      const author = phones[AUTHOR];
      try {
        await author.waitForSelector('#finale-revise:not([hidden])', { timeout: 6000 });
        acted.add(key);
        const others = await Promise.all(phones.filter((_, i) => i !== AUTHOR).map((p) => p.evaluate(() => !document.getElementById('finale-revise').hidden)));
        revisePrivacy = {
          feedback: await author.textContent('#finale-feedback'),
          othersShowModal: others.filter(Boolean).length
        };
        await author.fill('#finale-revise-text', SECOND);
        await author.click('#finale-revise-submit');
      } catch (e) {
        acted.add(key);
        problems.push(`author phone never showed the revise modal: ${e.message.split('\n')[0]}`);
      }
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
    // The projector must never show the unsafe (or joke) write-in.
    if (game.cycle === 5 && !leaked) {
      const text = await host.evaluate(() => document.body.innerText).catch(() => '');
      if (UNSAFE.test(text) || JOKE.test(text)) leaked = `${key}: projector text contains the flagged write-in`;
    }
    await host.waitForTimeout(150);
  }
  await host.waitForTimeout(2000);

  const finale = game.finale || {};
  const expected = ['INCIDENT', 'FINALE_WRITE', 'FINALE_MOD', 'FINALE_DEBATE', 'FINALE_RANK', 'FINALE_ENACT', 'END'];
  // FINALE_MOD is announced again when the resubmit window opens: collapse repeats.
  const ran = phases.filter((p) => p.startsWith('5:')).map((p) => p.slice(2)).filter((p, i, a) => p !== a[i - 1]);
  if (phases.filter((p) => p === '5:FINALE_MOD').length !== 2) problems.push('the resubmit window was not announced');
  if (ran.join(' ') !== expected.join(' ')) problems.push(`finale ran ${ran.join(' -> ')}`);
  if (game.phase !== 'END') problems.push(`game stopped at ${game.cycle}:${game.phase}`);
  if (leaked) problems.push(leaked);
  const hostEnd = await host.evaluate(() => document.body.innerText);
  if (UNSAFE.test(hostEnd) || JOKE.test(hostEnd)) problems.push('End Screen text contains the flagged write-in');

  // Private feedback: a "revise" to the author only, then the final verdict.
  const toAuthor = feedback.filter((f) => f.node === authorNode);
  const toOthers = feedback.filter((f) => f.node !== authorNode);
  if (!toAuthor.length || toAuthor[0].status !== 'revise') problems.push(`author's first feedback ${JSON.stringify(toAuthor[0])}`);
  if (toOthers.some((f) => f.status !== 'ok')) problems.push(`other authors got ${JSON.stringify(toOthers.filter((f) => f.status !== 'ok'))}`);
  if (!revisePrivacy) problems.push('revise modal not checked');
  else {
    if (revisePrivacy.othersShowModal) problems.push(`${revisePrivacy.othersShowModal} other phone(s) showed the revise modal`);
    const want = SCENARIO === 'revise' ? REVISE_FEEDBACK : loom.localPrefilter(FIRST) && 'The Loom cannot put that language';
    if (!revisePrivacy.feedback || !revisePrivacy.feedback.includes(want)) problems.push(`author phone feedback "${revisePrivacy.feedback}"`);
  }

  const policies = finale.policies || [];
  const mine = policies.find((p) => p.node === authorNode);
  if (policies.length !== 5) problems.push(`${policies.length} finale policies`);
  if (policies.some((p) => UNSAFE.test(p.text) || JOKE.test(p.text))) problems.push('a flagged write-in reached the finale policies');
  if (SCENARIO === 'revise') {
    if (!mine || mine.text !== SECOND || mine.placeholder) problems.push(`author's policy ${JSON.stringify(mine && mine.text)}, want the clean resubmission`);
    if (toAuthor.at(-1).status !== 'ok') problems.push(`author's final feedback ${toAuthor.at(-1).status}`);
  } else {
    if (!mine || mine.text !== loom.PLACEHOLDER_TEXT || !mine.placeholder) problems.push(`author's policy ${JSON.stringify(mine && mine.text)}, want the placeholder`);
    if (toAuthor.at(-1).status !== 'reject') problems.push(`author's final feedback ${toAuthor.at(-1).status}`);
    const status = await phones[AUTHOR].textContent('#finale-wait-status').catch(() => '');
    if (!/standard protocol policy/.test(status) && game.phase !== 'END') problems.push(`author phone status "${status}"`);
    if (seenByGemini.some((t) => UNSAFE.test(t))) problems.push('the unsafe text was sent to Gemini (pre-filter missed it)');
  }

  // Borda: recount 4/3/2/1 from the five phones' own rankings.
  if (rankedBy.size !== 5) problems.push(`only ${rankedBy.size} phones ranked from the UI`);
  const points = {};
  for (const ids of Object.values(finale.ranks || {})) ids.forEach((id, i) => { points[id] = (points[id] || 0) + [4, 3, 2, 1][i]; });
  const authors = (game.endData && game.endData.authors) || [];
  for (const a of authors) if (a.points !== (points[a.id] || 0)) problems.push(`${a.id}: game:end ${a.points} Borda points, recount ${points[a.id] || 0}`);
  const enacted = finale.enacted || [];
  if (enacted.map((e) => e.weight).join('/') !== '0.5/0.25/0.25') problems.push(`enacted weights ${enacted.map((e) => e.weight).join('/')}`);
  const top = Object.entries(points).sort((a, b) => b[1] - a[1]);
  if (enacted[0] && points[enacted[0].id] !== top[0][1]) problems.push(`50% policy ${enacted[0].id} has ${points[enacted[0].id]} points, the top is ${top[0][1]}`);

  problems.push(...errors);
  await browser.close();
  server.close();
  console.log = log; console.warn = warn;
  const name = SCENARIO === 'revise' ? 'MODERATION' : 'REJECTION';
  if (problems.length) {
    process.stderr.write(`E2E ${name} FAILED:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  const summary = SCENARIO === 'revise'
    ? `${authorNode} got private "revise" feedback, resubmitted from the phone and was accepted`
    : `${authorNode}'s unsafe write-in was pre-filtered twice (never sent to Gemini, never on the projector) and replaced by the placeholder`;
  process.stderr.write(`E2E ${name} OK: ${summary}; 5 phones ranked, Borda matches a recount, enacted ${enacted.map((e) => `${e.id} ${e.weight * 100}%`).join(', ')}\n`);
  process.exit(0);
})().catch((e) => { process.stderr.write('E2E MODERATION FAILED ' + e.stack + '\n'); process.exit(1); });
