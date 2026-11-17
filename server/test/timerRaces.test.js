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
