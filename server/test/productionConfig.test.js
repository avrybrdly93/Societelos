'use strict';

// TASK-795: production configuration defaults are locked to
// DEBATE_SECONDS=60 and SHOW_FORECAST_BEFORE_VOTE=false in every deploy
// path (local .env from .env.example, Render, Docker), and a server
// started with them really runs 60 s debates with the forecast hidden.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const engine = require('../gameEngine');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('.env.example sets DEBATE_SECONDS=60 and SHOW_FORECAST_BEFORE_VOTE=false', () => {
  const env = read('.env.example');
  assert.match(env, /^DEBATE_SECONDS=60$/m);
  assert.match(env, /^SHOW_FORECAST_BEFORE_VOTE=false$/m);
});

test('render.yaml and the Dockerfile lock the same defaults', () => {
  const render = read('render.yaml');
  assert.match(render, /- key: DEBATE_SECONDS\s*\n\s*value: "60"/);
  assert.match(render, /- key: SHOW_FORECAST_BEFORE_VOTE\s*\n\s*value: "false"/);
  const docker = read('Dockerfile');
  assert.match(docker, /^ENV .*\bDEBATE_SECONDS=60\b/m);
  assert.match(docker, /^ENV .*\bSHOW_FORECAST_BEFORE_VOTE=false\b/m);
});

test('a room created under the production env runs 60 s debates with the forecast hidden', () => {
  const saved = { d: process.env.DEBATE_SECONDS, s: process.env.SHOW_FORECAST_BEFORE_VOTE, f: process.env.FAST_TIMERS };
  process.env.DEBATE_SECONDS = '60';
  process.env.SHOW_FORECAST_BEFORE_VOTE = 'false';
  delete process.env.FAST_TIMERS;
  try {
    const game = new engine.GameState({ roomCode: 'PROD' });
    assert.deepEqual(game.getConfig(), { debateSeconds: 60, showForecastBeforeVote: false });
    assert.equal(game.durations.DEBATE, 60000);
    game.stop();
  } finally {
    for (const [k, v] of [['DEBATE_SECONDS', saved.d], ['SHOW_FORECAST_BEFORE_VOTE', saved.s], ['FAST_TIMERS', saved.f]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
