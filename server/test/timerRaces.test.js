'use strict';

// TASK-616: phase-timer race audit. A vote, policy or ranking that lands at
// the exact moment its phase timer expires is either counted before the
// phase closes or refused after it - never both, never a double advance.

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const { GameState, NODE_IDS } = engine;
const { playGame, okModeration, withLoom } = require('./playGame');

/** A seated game paused at Cycle 1 VOTE with real (mocked-clock) phase lengths. */
function gameAtVote(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const saved = { fast: process.env.FAST_TIMERS, key: process.env.GEMINI_API_KEY };
  delete process.env.FAST_TIMERS;
  delete process.env.GEMINI_API_KEY;
  const game = new GameState({ roomCode: 'RACE' });
  if (saved.fast !== undefined) process.env.FAST_TIMERS = saved.fast;
  if (saved.key !== undefined) process.env.GEMINI_API_KEY = saved.key;
  const log = console.log;
  console.log = () => {};
  t.after(() => { game.stop(); console.log = log; });
  NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
  game.startIntroPhase();
  game.clearPhaseTimer();
  game.startCycle(1);
  game.crisis = engine.selectCrisis(game.data.crises, 1, null, game.data.roles);
  const phases = [];
  game.on('phase', (p) => phases.push(p.phase));
  game.startBlindVotePhase();
  return { game, phases, voteMs: game.durations.VOTE };
}

test('a vote 1 ms before the VOTE timer expires still counts', (t) => {
  const { game, voteMs } = gameAtVote(t);
  for (const n of NODE_IDS.slice(0, 4)) assert.equal(game.castVote(n, 'A').ok, true);
  t.mock.timers.tick(voteMs - 1);
  assert.equal(game.phase, 'VOTE');
  assert.equal(game.castVote('NODE-05', 'B').ok, true);
  assert.equal(Object.keys(game.votes).length, 5);
});

test('a vote that arrives in the same tick the VOTE timer fires is refused and not counted', (t) => {
  const { game, phases, voteMs } = gameAtVote(t);
  for (const n of NODE_IDS.slice(0, 4)) game.castVote(n, 'A');
  t.mock.timers.tick(voteMs);
  assert.equal(game.phase, 'RESOLUTION');
  assert.deepEqual(game.castVote('NODE-05', 'B'), { ok: false, reason: 'VOTING_CLOSED' });
  assert.equal(Object.keys(game.votes).length, 4);
  assert.deepEqual(phases, ['VOTE', 'RESOLUTION'], 'one advance');
});

test('an early advance (all 5 votes in) cancels the VOTE timer: no second advance when it would have fired', (t) => {
  const { game, phases, voteMs } = gameAtVote(t);
  for (const n of NODE_IDS) game.castVote(n, 'A');
  assert.equal(game.allVotesIn(), true);
  game.advancePhase(); // what socket.js does on the 5th vote
  assert.equal(game.phase, 'RESOLUTION');
  t.mock.timers.tick(voteMs);
  assert.deepEqual(phases, ['VOTE', 'RESOLUTION'], 'exactly one RESOLUTION');
  assert.equal(game.cycle, 1);
});

test('stale phase-timer callbacks are ignored after the timer is replaced', (t) => {
  const { game } = gameAtVote(t);
  let fired = 0;
  game.startPhaseTimer(1000, () => { fired++; });
  game.startPhaseTimer(5000, () => { fired += 10; });
  t.mock.timers.tick(1000);
  assert.equal(fired, 0, 'the replaced timer never runs');
  t.mock.timers.tick(4000);
  assert.equal(fired, 10);
});

test('late finale writes, ranks and votes after their phase closes are refused in a full game', async () => {
  const late = {};
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    await playGame({
      gameId: 'races-late',
      world: 'AA',
      onEvent: (type, ev, game) => {
        if (type !== 'phase') return;
        if (ev.cycle === 1 && ev.phase === 'RESOLUTION') late.vote = game.castVote('NODE-01', 'B');
        if (ev.phase === 'FINALE_MOD' && !late.write) late.write = game.submitPolicy('NODE-01', 'A late policy');
        if (ev.phase === 'FINALE_ENACT') {
          const ballot = (game.finale.ballots['NODE-02'] || []).slice().reverse();
          late.rank = game.rankPolicies('NODE-02', ballot);
        }
      }
    });
  });
  assert.deepEqual(late.vote, { ok: false, reason: 'VOTING_CLOSED' });
  assert.deepEqual(late.write, { ok: false, reason: 'WRITING_CLOSED' });
  assert.deepEqual(late.rank, { ok: false, reason: 'RANKING_CLOSED' });
});

// TASK-617 ------------------------------------------------------------------

test('isTransitioning is held while the RESOLUTION narration is in flight and released after', async (t) => {
  const { game } = gameAtVote(t);
  t.mock.timers.reset();
  for (const n of NODE_IDS) game.castVote(n, 'A');
  const p = game.advancePhase() && game.transition && game.transition.promise;
  assert.equal(game.phase, 'RESOLUTION');
  assert.equal(game.isTransitioning, true);
  await p;
  assert.equal(game.isTransitioning, false);
  game.clearPhaseTimer();
});

test('a second RESOLUTION start while transitioning re-uses the in-flight call: no double scoring', async (t) => {
  const { game } = gameAtVote(t);
  t.mock.timers.reset();
  const resolutions = [];
  game.on('resolution', (r) => resolutions.push(r));
  for (const n of NODE_IDS) game.castVote(n, 'A');
  game.advancePhase();
  const first = game.transition.promise;
  const scores = { ...game.scores };
  const ledger = game.scoreLedger.length;
  assert.equal(game.startResolutionPhase(), first, 'same promise');
  assert.deepEqual(game.scores, scores);
  assert.equal(game.scoreLedger.length, ledger);
  await first;
  assert.equal(resolutions.length, 1);
  game.clearPhaseTimer();
});

test('a narration that returns after its phase moved on is not broadcast, but the lock is released', async (t) => {
  const { game } = gameAtVote(t);
  t.mock.timers.reset();
  const loom = require('../loom');
  const realNarrate = loom.narrate;
  let finish;
  loom.narrate = () => new Promise((resolve) => { finish = resolve; });
  t.after(() => { loom.narrate = realNarrate; });
  const resolutions = [];
  game.on('resolution', (r) => resolutions.push(r));
  for (const n of NODE_IDS) game.castVote(n, 'A');
  game.advancePhase();
  const pending = game.transition.promise;
  await new Promise((r) => setImmediate(r));
  game.advancePhase(); // e.g. the safety timer or a debug skip: RESOLUTION -> INCIDENT (cycle 2)
  assert.equal(game.isTransitioning, false, 'leaving the phase drops the lock');
  finish({ loomLine: 'Too late.', messages: [] });
  await pending;
  assert.equal(resolutions.length, 0, 'no stale resolution repaints the screen');
  game.clearPhaseTimer();
});

// TASK-634 ------------------------------------------------------------------

test('FINALE_MOD waits for a slow Gemini moderation; FINALE_DEBATE then gets its full timer', { timeout: 30000 }, async () => {
  const DELAY = 600;
  const stamps = {};
  await withLoom({
    moderate: (subs) => new Promise((resolve) => setTimeout(() => resolve(okModeration(subs)), DELAY))
  }, async () => {
    const out = await playGame({
      gameId: 'slow-moderation',
      world: 'AB',
      phaseSeconds: { FINALE_MOD: 10, FINALE_DEBATE: 1 },
      onEvent: (type, ev) => {
        if (type === 'phase' && ev.cycle === 5) stamps[ev.phase] = { at: Date.now(), endsAt: ev.endsAt };
      }
    });
    assert.deepEqual(out.phases.filter((p) => p.startsWith('5:')).slice(2, 4), ['5:FINALE_MOD', '5:FINALE_DEBATE']);
  });
  const modLasted = stamps.FINALE_DEBATE.at - stamps.FINALE_MOD.at;
  assert.ok(modLasted >= DELAY - 20, `FINALE_MOD held until moderation returned (${modLasted} ms)`);
  assert.ok(modLasted < 10000, 'and moved on as soon as it did, not at the 10 s timer');
  const debateMs = stamps.FINALE_DEBATE.endsAt - stamps.FINALE_DEBATE.at;
  assert.ok(Math.abs(debateMs - 1000) < 50, `FINALE_DEBATE got its full timer (${debateMs} ms)`);
});

// TASK-635 ------------------------------------------------------------------

test('RESOLUTION waits for a slow loom.narrate, then runs the full playback timer from the payload', { timeout: 30000 }, async () => {
  const DELAY = 400;
  const loom = require('../loom');
  const realNarrate = loom.narrate;
  const cycle1 = {};
  await withLoom({
    narrate: (ctx, opts) => new Promise((resolve) => setTimeout(() => resolve(realNarrate(ctx, opts)), DELAY))
  }, async () => {
    await playGame({
      gameId: 'slow-narration',
      world: 'AA',
      phaseSeconds: { RESOLUTION: 1 },
      onEvent: (type, ev, game) => {
        if (type === 'phase' && ev.cycle === 1 && ev.phase === 'RESOLUTION') {
          cycle1.phaseAt = Date.now();
          game.once('resolution', (r) => { cycle1.payloadAt = Date.now(); cycle1.endsAt = r.endsAt; });
        }
        if (type === 'phase' && ev.cycle === 2 && ev.phase === 'INCIDENT' && !cycle1.nextAt) cycle1.nextAt = Date.now();
      }
    });
  });
  const waited = cycle1.payloadAt - cycle1.phaseAt;
  assert.ok(waited >= DELAY - 20, `the payload waited for the narration (${waited} ms)`);
  const playback = cycle1.endsAt - cycle1.payloadAt;
  assert.ok(Math.abs(playback - 1000) < 50, `full playback timer from the payload (${playback} ms)`);
  const total = cycle1.nextAt - cycle1.phaseAt;
  assert.ok(total >= DELAY + 1000 - 30, `the animation was never cut short (${total} ms in RESOLUTION)`);
});

// TASK-636 ------------------------------------------------------------------

test('rapid phase skipping through a whole game leaves exactly one live timer and no stragglers', { timeout: 30000 }, async () => {
  const saved = { fast: process.env.FAST_TIMERS, key: process.env.GEMINI_API_KEY };
  delete process.env.FAST_TIMERS; // real (long) timers: only the skips move the game
  delete process.env.GEMINI_API_KEY;
  const game = new GameState({ roomCode: 'SKIP' });
  if (saved.fast !== undefined) process.env.FAST_TIMERS = saved.fast;
  if (saved.key !== undefined) process.env.GEMINI_API_KEY = saved.key;
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const phases = [];
  try {
    NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
    game.on('phase', (p) => phases.push(`${p.cycle}:${p.phase}`));
    game.startIntroPhase();
    let skips = 0;
    while (game.phase !== 'END' && skips < 300) {
      // Debug skip: every phase is cut short the moment it starts, sometimes
      // twice in the same tick, sometimes after async work had a chance to run.
      game.advancePhase();
      skips++;
      assert.ok(game.phase === 'END' || game.phaseTimer || game.endsAt === null, `one live timer after skip ${skips}`);
      if (skips % 3 === 0) await new Promise((r) => setImmediate(r));
    }
    assert.equal(game.phase, 'END', `reached END after ${skips} skips`);
    assert.equal(game.phaseTimer, null, 'END has no timer');
    const count = phases.length;
    // Give any stale timer or late Loom call time to misfire.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(phases.length, count, `no phase events after END (${phases.slice(count).join(' ')})`);
    assert.equal(game.phase, 'END');
    assert.ok(phases.includes('5:END'), 'played to the end of Cycle 5');
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    game.stop();
    console.log = log;
    console.error = err;
  }
});
