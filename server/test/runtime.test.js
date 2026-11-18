'use strict';

// TASK-767: total game runtime with 60 s debates.
//
// A real game is played through the engine (shrunk timers, write-in finale
// with moderation stubbed) to get the exact sequence of timed phases it
// visits, Lobby to End. Each visited phase is then charged its shipped
// length from DEFAULT_PHASE_SECONDS (DEBATE set to the lobby's 60 s choice), plus about a minute for the End Screen reveal (its three
// beats land at 0 / 15 / 25 s, then the class reads the recap). Every timer
// is charged in full: early advances (all votes in, everyone ready) only make
// a real game shorter.
//
// Spec target: ~13.5 min with 60 s debates.

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../gameEngine');
const { playGame, okModeration, withLoom } = require('./playGame');

const END_SCREEN_SECONDS = 60;
const TOLERANCE_MIN = 0.5;

let visited = null;
async function phaseSequence() {
  if (visited) return visited;
  const out = await withLoom({ moderate: async (subs) => okModeration(subs) }, () => playGame({ gameId: 'runtime-767', world: 'AB' }));
  visited = out.phases.map((p) => p.split(':')[1]);
  return visited;
}

function runtimeMinutes(phases, debateSeconds) {
  const secs = { ...engine.DEFAULT_PHASE_SECONDS, DEBATE: debateSeconds };
  const timed = phases.filter((p) => p !== 'END' && p !== 'LOBBY');
  for (const p of timed) assert.ok(typeof secs[p] === 'number', `no shipped length for ${p}`);
  const total = timed.reduce((s, p) => s + secs[p], 0) + END_SCREEN_SECONDS;
  return total / 60;
}

test('the played game visits the full spec phase sequence (4 binary cycles, World Reveal, write-in finale)', async () => {
  const phases = await phaseSequence();
  assert.deepEqual(phases.slice(0, 3), ['INTRO', 'ROLE_ASSIGN', 'CHAMBER']);
  assert.equal(phases.filter((p) => p === 'DEBATE').length, 4, 'four timed debates (Cycles 1-4)');
  assert.equal(phases.filter((p) => p === 'WORLD_REVEAL').length, 1);
  for (const p of ['FINALE_WRITE', 'FINALE_MOD', 'FINALE_DEBATE', 'FINALE_RANK', 'FINALE_ENACT']) assert.ok(phases.includes(p), `missing ${p}`);
  assert.equal(phases.at(-1), 'END');
});

test('TASK-767: total runtime with 60 s debates lands at ~13.5 minutes', async () => {
  const min = runtimeMinutes(await phaseSequence(), 60);
  assert.ok(Math.abs(min - 13.5) <= TOLERANCE_MIN, `60 s debates: ${min.toFixed(2)} min`);
});

module.exports = { runtimeMinutes, phaseSequence };
