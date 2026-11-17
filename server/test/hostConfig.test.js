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

test('host:config switches the debate timer between 90 s and 60 s in the lobby', () => {
  const game = lobbyGame();
  assert.equal(game.getConfig().debateSeconds, 90, 'default: the 16-minute game');
  assert.deepEqual(game.configure({ debateSeconds: 60 }), { ok: true, config: game.getConfig() });
  assert.equal(game.durations.DEBATE, 60000);
  assert.equal(game.getConfig().debateSeconds, 60);
  assert.equal(game.configure({ debateSeconds: 90 }).ok, true);
  assert.equal(game.durations.DEBATE, 90000);
});

test('host:config rejects other debate lengths and any change once the game has started', () => {
  const game = lobbyGame();
  assert.deepEqual(game.configure({ debateSeconds: 45 }), { ok: false, reason: 'BAD_DEBATE_SECONDS' });
  assert.deepEqual(game.configure({ debateSeconds: '60' }), { ok: false, reason: 'BAD_DEBATE_SECONDS' });
  assert.equal(game.durations.DEBATE, 90000, 'unchanged');
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.forEach((n, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(n, true); });
    game.startIntroPhase();
    assert.deepEqual(game.configure({ debateSeconds: 60 }), { ok: false, reason: 'GAME_IN_PROGRESS' });
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});

test('the configured debate length is what the DEBATE phase timer uses', () => {
  const game = lobbyGame();
  game.configure({ debateSeconds: 60 });
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
    assert.ok(Math.abs(game.endsAt - before - 60000) < 1000, 'DEBATE ends 60 s from now');
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});
