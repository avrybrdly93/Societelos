'use strict';

// TASK-687: the opening sequence runs on real phase lengths with no host
// input: Intro Crawl (30 s) -> Role Assign (20 s) -> Chamber (10 s) ->
// Cycle 1 INCIDENT at exactly t = 60 s. Each phase's endsAt matches its
// spec duration and no phase advances a millisecond early.

const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState, NODE_IDS } = require('../gameEngine');

function seatedGame(t, env = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const saved = { fast: process.env.FAST_TIMERS, key: process.env.GEMINI_API_KEY, debate: process.env.DEBATE_SECONDS };
  delete process.env.FAST_TIMERS;
  delete process.env.GEMINI_API_KEY;
  delete process.env.DEBATE_SECONDS;
  Object.assign(process.env, env);
  const game = new GameState({ roomCode: 'SETUP' });
  for (const [k, name] of [['fast', 'FAST_TIMERS'], ['key', 'GEMINI_API_KEY'], ['debate', 'DEBATE_SECONDS']]) {
    if (saved[k] === undefined) delete process.env[name]; else process.env[name] = saved[k];
  }
  const log = console.log;
  console.log = () => {};
  t.after(() => { game.stop(); console.log = log; t.mock.timers.reset(); });
  NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
  const phases = [];
  game.on('phase', (p) => phases.push({ phase: p.phase, cycle: p.cycle, at: Date.now(), endsAt: p.endsAt }));
  return { game, phases };
}

test('spec setup lengths are 30 s + 20 s + 10 s', (t) => {
  const { game } = seatedGame(t);
  assert.equal(game.durations.INTRO, 30_000);
  assert.equal(game.durations.ROLE_ASSIGN, 20_000);
  assert.equal(game.durations.CHAMBER, 10_000);
});

test('Intro -> Role Assign -> Chamber -> Cycle 1 INCIDENT lands at exactly 60 s', (t) => {
  const { game, phases } = seatedGame(t);
  const t0 = Date.now();
  assert.equal(game.startIntroPhase(), true);

  const steps = [
    ['INTRO', 30_000, 'ROLE_ASSIGN'],
    ['ROLE_ASSIGN', 20_000, 'CHAMBER'],
    ['CHAMBER', 10_000, 'INCIDENT']
  ];
  for (const [phase, ms, next] of steps) {
    assert.equal(game.phase, phase);
    const entry = phases[phases.length - 1];
    assert.equal(entry.phase, phase);
    assert.equal(entry.endsAt - entry.at, ms, `${phase} endsAt is ${ms} ms out`);
    t.mock.timers.tick(ms - 1);
    assert.equal(game.phase, phase, `${phase} must not advance early`);
    t.mock.timers.tick(1);
    assert.equal(game.phase, next, `${phase} advances to ${next} on time`);
  }

  assert.equal(Date.now() - t0, 60_000);
  assert.equal(game.cycle, 1);
  assert.deepEqual(phases.map((p) => p.phase), ['INTRO', 'ROLE_ASSIGN', 'CHAMBER', 'INCIDENT']);
  assert.equal(phases[3].cycle, 1);
  assert.ok(game.crisis, 'Cycle 1 crisis is loaded when INCIDENT opens');
});

test('the setup sequence is unaffected by the teacher debate length (60 s vs 90 s)', (t) => {
  const { game } = seatedGame(t, { DEBATE_SECONDS: '60' });
  assert.equal(game.durations.DEBATE, 60_000);
  game.startIntroPhase();
  t.mock.timers.tick(30_000); // mocked clock: tick each chained phase timer separately
  t.mock.timers.tick(20_000);
  t.mock.timers.tick(9_999);
  assert.equal(game.phase, 'CHAMBER');
  t.mock.timers.tick(1);
  assert.equal(game.phase, 'INCIDENT');
});
