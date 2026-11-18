'use strict';

// Thursday content audit (TASK-709 onward) over the 14 core crises a game
// can reach: 2 fixed + per world its Cycle 3-4 binaries and its finale.

const test = require('node:test');
const assert = require('node:assert/strict');

const data = require('../../data/crises.json');

const ROLES = ['artisan', 'lotus', 'assimilator', 'catalyst', 'ghost'];
const finaleIds = new Set(Object.values(data.worlds).map((w) => w.finale));
const CORE = data.crises.filter((c) => c.world === 'fixed'
  || (c.mode === 'binary' && (c.cycle === 3 || c.cycle === 4))
  || finaleIds.has(c.id));

test('the core set is 14 crises', () => {
  assert.equal(CORE.length, 14);
});

// TASK-709: 70 drops, each readable in 20 s on a phone (<= 180 chars) and
// framed as an in-world document ("Loom archive:", "Leaked memo:", ...).
test('all 70 Intel Drops are <= 180 characters with in-world document framing', () => {
  let n = 0;
  for (const c of CORE) {
    for (const role of ROLES) {
      const drop = c.intel && c.intel[role];
      assert.equal(typeof drop, 'string', `${c.id}/${role} missing`);
      assert.ok(drop.length <= 180, `${c.id}/${role} is ${drop.length} chars`);
      assert.match(drop, /^[A-Z][a-z]*( [a-z]+){0,3}: \S/, `${c.id}/${role} lacks a "Source label:" opener: ${drop}`);
      n++;
    }
  }
  assert.equal(n, 70);
});

// TASK-710: every Catalyst drop is a forecast that tells the Catalyst where
// the GDW swing (or the calm) is. Directions and sizes were checked against
// npm run calibrate:crises (median delta and p5-95 spread per option).
test('every Catalyst Intel Drop is a forecast that names the swing', () => {
  for (const c of CORE) {
    const drop = c.intel.catalyst;
    assert.match(drop.split(':')[0], /forecast/i, `${c.id}: Catalyst drop is not a forecast`);
    assert.match(drop, /swing|spread|whipsaw|crash|points|barely|flat/i, `${c.id}: Catalyst drop does not say what moves the line`);
  }
});
