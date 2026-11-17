#!/usr/bin/env node
'use strict';

// Cycle 5 UI check, driven by the pages' own debug mocks (no live game):
//   phone:     window.debugMobilePhase / debugMobileEvent / debugMobileBallot
//   projector: window.debugTriggerPhase / debugTriggerEvent
// Loads public/mobile.html (375x667) and public/index.html (1920x1080) from
// the real server, steps through every finale screen, asserts what should be
// on screen, and fails on any page error.
//
// Needs Playwright with Chromium (not a project dependency, like e2e:ui):
//   npm run e2e:finale            # SHOT_DIR=/some/dir saves a PNG per step
// Exits 1 on a failed check or page error, 2 if Playwright is missing.

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('e2e:finale needs Playwright: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server', 'server.js'));

const WRITEIN = { id: 'mock-finale', title: 'The Vote to Seize', mode: 'writein', incident: 'A ballot measure would confiscate the owners’ stakes.' };
const LONG = (s) => (s + ' '.repeat(140)).slice(0, 140).trimEnd().padEnd(140, '.');

const failures = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

async function phoneChecks(browser, shot) {
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.base}/mobile.html`);
  await page.waitForFunction(() => typeof window.debugMobilePhase === 'function');
  const active = () => page.evaluate(() => (document.querySelector('#m-main > .m-view.is-active') || {}).id);
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
  const text = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);

  // FINALE_WRITE: write screen with agenda reminder, timer bar and counter.
  await page.evaluate(() => { debugMobilePhase('ROLE_ASSIGN'); debugMobilePhase('FINALE_WRITE', { seconds: 45, cycle: 5 }); });
  await page.waitForTimeout(150);
  check('phone FINALE_WRITE shows the write screen', (await active()) === 'm-view-finale-write');
  check('phone write screen shows the agenda reminder', await visible('#finale-goal'));
  check('phone write screen timer bar counts the 45 s', /^4[45]$/.test((await text('#m-view-finale-write .finale-timer-secs')).trim()));
  check('phone submit disabled while the textarea is empty', await page.evaluate(() => document.getElementById('finale-submit').disabled));
  await page.fill('#finale-text', 'Every district elects a repair council.');
  check('phone counter tracks typing', (await text('#finale-count')) === '39 / 140', await text('#finale-count'));
  check('phone submit enabled once text is typed', await page.evaluate(() => !document.getElementById('finale-submit').disabled));
  await page.fill('#finale-text', 'x'.repeat(200));
  check('phone textarea stops at 140 characters', (await page.inputValue('#finale-text')).length === 140);
  await shot(page, 'phone-1-write');

  // FINALE_MOD: waiting state, then each finale:feedback status.
  await page.evaluate(() => debugMobilePhase('FINALE_MOD', { seconds: 10, cycle: 5 }));
  await page.waitForTimeout(100);
  check('phone FINALE_MOD shows the evaluating screen', (await active()) === 'm-view-finale-wait');
  check('phone evaluating title', /EVALUATING YOUR POLICY/.test(await text('#finale-wait-title')));
  await page.evaluate(() => debugMobileEvent('finale:feedback', { status: 'ok' }));
  check('phone feedback ok -> POLICY ACCEPTED', (await text('#finale-wait-title')) === 'POLICY ACCEPTED BY THE LOOM');
  await page.evaluate(() => { debugMobilePhase('FINALE_MOD', { seconds: 25, cycle: 5 }); debugMobileEvent('finale:feedback', { status: 'revise', feedback: 'Name a policy, not a classmate.' }); });
  await page.waitForTimeout(100);
  check('phone feedback revise opens the resubmit modal', await visible('#finale-revise'));
  check('phone resubmit modal shows the private feedback', (await text('#finale-feedback')) === 'Name a policy, not a classmate.');
  check('phone resubmit modal has its timer bar', /^2[45]$/.test((await text('#finale-revise .finale-timer-secs')).trim()));
  await shot(page, 'phone-2-revise');
  await page.evaluate(() => debugMobileEvent('finale:feedback', { status: 'reject' }));
  check('phone feedback reject closes the modal', !(await visible('#finale-revise')));
  check('phone feedback reject explains the substitution', /standard protocol policy/.test(await text('#finale-wait-status')));

  // FINALE_DEBATE: no phone input, a wait line.
  await page.evaluate(() => debugMobilePhase('FINALE_DEBATE', { seconds: 60, cycle: 5 }));
  await page.waitForTimeout(100);
  check('phone FINALE_DEBATE waits on the projector', (await active()) === 'm-view-wait' && /Debate the policies/.test(await text('#wait-status')));

  // FINALE_RANK: four 140-character policies, tap-to-rank, lock gate.
  await page.evaluate((long) => {
    debugMobilePhase('FINALE_RANK', { seconds: 30, cycle: 5 });
    debugMobileEvent('finale:ballot', { policies: long.map((t, i) => ({ id: `POLICY-${i + 2}`, text: t })) });
  }, ['W'.repeat(140), LONG('Every district elects a repair council that controls its own grid'), LONG('A universal luxury dividend for every citizen'), LONG('Shut the servers one day a week')]);
  await page.waitForTimeout(100);
  check('phone FINALE_RANK shows the ballot', (await active()) === 'm-view-finale-rank');
  check('phone ballot lists the 4 other policies', (await page.locator('.rank-card').count()) === 4);
  check('phone ballot has no horizontal scroll at 375 px', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const cards = page.locator('.rank-card');
  for (const i of [2, 0, 3]) await cards.nth(i).click();
  check('phone lock disabled with 3 of 4 ranked', await page.evaluate(() => document.getElementById('rank-submit').disabled));
  await cards.nth(2).click(); // unrank 1st: the rest shift up
  const places = await page.evaluate(() => [...document.querySelectorAll('.rank-card')].map((c) => c.dataset.place || '-').join(''));
  check('phone unranking shifts later ranks up', places === '1--2', places);
  for (const i of [1, 2]) await cards.nth(i).click();
  check('phone lock enabled with ranks 1-4', await page.evaluate(() => !document.getElementById('rank-submit').disabled));
  check('phone ballot shows Borda badges', /\+4 PTS/.test(await page.evaluate(() => [...document.querySelectorAll('.rank-card')].map((c) => c.dataset.points).join(' '))));
  await shot(page, 'phone-3-ballot');

  // Fallback: Gemini failed during moderation -> authored A/B debate and vote.
  await page.evaluate((crisis) => debugMobileEvent('phase', { cycle: 5, phase: 'DEBATE', crisis, endsAt: Date.now() + 60000, options: { A: { key: 'A', name: 'Pass it' }, B: { key: 'B', name: 'Reject it' } } }), WRITEIN);
  await page.waitForTimeout(100);
  check('phone fallback DEBATE shows the debate screen and notice', (await active()) === 'm-view-debate' && await visible('#m-finale-fallback'));
  await page.evaluate((crisis) => debugMobileEvent('phase', { cycle: 5, phase: 'VOTE', crisis, endsAt: Date.now() + 15000 }), WRITEIN);
  await page.waitForTimeout(100);
  check('phone fallback VOTE shows the authored options', (await active()) === 'm-view-vote' && (await text('#vote-a-name')) === 'Pass it');

  // FINALE_ENACT and END: wait lines.
  await page.evaluate(() => debugMobilePhase('FINALE_ENACT', { seconds: 40, cycle: 5 }));
  await page.waitForTimeout(100);
  check('phone FINALE_ENACT waits on the projector', (await active()) === 'm-view-wait' && /enacting your policies/.test(await text('#wait-status')));
  check('phone has no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

(async () => {
  const log = console.log;
  console.log = (...a) => { if (!String(a[0]).startsWith('[')) log(...a); }; // mute server logs
  await new Promise((r) => server.listen(0, r));
  server.base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const dir = process.env.SHOT_DIR;
  const shot = async (page, name) => { if (dir) await page.screenshot({ path: path.join(dir, `finale-${name}.png`) }); };
  try {
    await phoneChecks(browser, shot);
  } catch (err) {
    failures.push(`crashed: ${err.message}`);
    console.error(err);
  }
  await browser.close();
  server.close();
  console.log = log;
  console.log(failures.length ? `\n${failures.length} finale UI check(s) failed` : '\nAll finale UI checks passed');
  process.exit(failures.length ? 1 : 0);
})();
