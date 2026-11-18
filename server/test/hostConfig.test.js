'use strict';

// Teacher settings chosen in the host lobby (host:config).

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const { GameState, NODE_IDS } = engine;

function lobbyGame() {
  const saved = { fast: process.env.FAST_TIMERS, debate: process.env.DEBATE_SECONDS };
  delete process.env.FAST_TIMERS;
  delete process.env.DEBATE_SECONDS;
  const game = new GameState({ roomCode: 'CONF' });
  for (const [k, v] of [['FAST_TIMERS', saved.fast], ['DEBATE_SECONDS', saved.debate]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return game;
}

// TASK-613 ------------------------------------------------------------------

test('host:config switches the debate timer between 165 s and 105 s (3- and 2-minute rounds) in the lobby', () => {
  const game = lobbyGame();
  assert.equal(game.getConfig().debateSeconds, 165, 'default: a 3-minute round with the vote');
  assert.deepEqual(game.configure({ debateSeconds: 105 }), { ok: true, config: game.getConfig() });
  assert.equal(game.durations.DEBATE, 105000);
  assert.equal(game.getConfig().debateSeconds, 105);
  assert.equal(game.configure({ debateSeconds: 165 }).ok, true);
  assert.equal(game.durations.DEBATE, 165000);
});

test('host:config rejects other debate lengths and any change once the game has started', () => {
  const game = lobbyGame();
  assert.deepEqual(game.configure({ debateSeconds: 45 }), { ok: false, reason: 'BAD_DEBATE_SECONDS' });
  assert.deepEqual(game.configure({ debateSeconds: '105' }), { ok: false, reason: 'BAD_DEBATE_SECONDS' });
  assert.equal(game.durations.DEBATE, 165000, 'unchanged');
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
    game.startIntroPhase();
    assert.deepEqual(game.configure({ debateSeconds: 105 }), { ok: false, reason: 'GAME_IN_PROGRESS' });
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});

test('the configured debate length is what the DEBATE phase timer uses', () => {
  const game = lobbyGame();
  game.configure({ debateSeconds: 105 });
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
    game.startIntroPhase();
    game.clearPhaseTimer();
    game.cycle = 1;
    game.startCycle(1);
    game.crisis = engine.selectCrisis(game.data.crises, 1, null, game.data.roles);
    const before = Date.now();
    game.startDebatePhase();
    assert.ok(Math.abs(game.endsAt - before - 105000) < 1000, 'DEBATE ends 105 s from now');
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});

// TASK-614 ------------------------------------------------------------------

test('host:config toggles showForecastBeforeVote, and DEBATE carries forecasts only when on', () => {
  const game = lobbyGame();
  game.showForecastBeforeVote = false;
  assert.equal(game.getConfig().showForecastBeforeVote, false);
  assert.deepEqual(game.configure({ showForecastBeforeVote: 'yes' }), { ok: false, reason: 'BAD_SHOW_FORECAST' });
  const res = game.configure({ showForecastBeforeVote: true, debateSeconds: 105 });
  assert.deepEqual(res, { ok: true, config: { debateSeconds: 105, showForecastBeforeVote: true } });

  const log = console.log;
  console.log = () => {};
  const debates = [];
  game.on('phase', (p) => { if (p.phase === 'DEBATE') debates.push(p); });
  try {
    NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
    game.startIntroPhase();
    game.clearPhaseTimer();
    game.startCycle(1);
    game.crisis = engine.selectCrisis(game.data.crises, 1, null, game.data.roles);
    game.startDebatePhase();
    game.showForecastBeforeVote = false;
    game.startDebatePhase();
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
  assert.ok(debates[0].forecasts && debates[0].forecasts.A && debates[0].forecasts.B, 'forecast fans shown before the vote');
  assert.equal(debates[1].forecasts, undefined, 'hidden when the toggle is off');
});

// TASK-615 ------------------------------------------------------------------

test('setSeed replays a historical game id in the lobby only; bad seeds are refused', () => {
  const game = lobbyGame();
  assert.equal(engine.isValidSeed('enddata-seed_01'), true);
  for (const bad of ['', 'has space', 'x'.repeat(65), 42, null, '../etc']) assert.equal(engine.isValidSeed(bad), false, String(bad));
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(game.setSeed('bad seed'), false);
    assert.equal(game.setSeed('class3-replay'), true);
    assert.equal(game.gameId, 'class3-replay');
    NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
    game.startIntroPhase();
    assert.equal(game.setSeed('too-late'), false);
    assert.equal(game.gameId, 'class3-replay');
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});

test('the same seed deals the same secret roles', () => {
  const deal = () => {
    const game = lobbyGame();
    const log = console.log;
    console.log = () => {};
    try {
      game.setSeed('same-roles');
      NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
      return NODE_IDS.map((n) => game.assignRoles(game.data.roles)[n].key);
    } finally {
      console.log = log;
    }
  };
  assert.deepEqual(deal(), deal());
});
