'use strict';

// Dev switch: JUMP_TO_FINALE=true opens the game straight at the Cycle 5 write-in.

const test = require('node:test');
const assert = require('node:assert/strict');

const { playGame, okModeration, withLoom } = require('./playGame');

test('JUMP_TO_FINALE skips cycles 1-4 and plays the write-in finale', async () => {
  process.env.JUMP_TO_FINALE = 'true';
  process.env.FINALE_WORLD = 'BA';
  try {
    await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
      const out = await playGame({ gameId: 'jump-01', world: 'AA' });
      const cycles = new Set(out.phases.map((p) => p.split(':')[0]));
      assert.deepEqual([...cycles].filter((c) => c !== '0' && c !== '1'), ['5'], 'only the finale cycle is played');
      assert.ok(out.phases.includes('5:FINALE_WRITE'), 'write-in phase reached');
      assert.ok(out.phases.includes('5:FINALE_MOD'), 'moderation phase reached');
      assert.equal(out.game.worldKey, 'BA');
      assert.equal(out.game.crisis.id, 'ba-vote-to-seize');
    });
  } finally {
    delete process.env.JUMP_TO_FINALE;
    delete process.env.FINALE_WORLD;
  }
});
