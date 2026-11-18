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

// TASK-711: World Reveal copy. Names, taglines and problems are the MVP spec
// strings; each world also has a short Loom revealLine for the projector.
test('each world reveal has spec name/tagline/problem and a projector-length Loom line', () => {
  const spec = {
    AA: ['The Commonwealth', 'Shared wealth, shared power', 'meaning'],
    AB: ['The Benevolent Machine', 'Shared wealth, the Loom rules', 'dependence'],
    BA: ['The Uneasy Republic', 'Rich owners, voting masses', 'class conflict'],
    BB: ['The Gilded Cage', 'Owners rule, masses on stipends', 'pacification']
  };
  for (const [key, [name, tagline, problemLeft]] of Object.entries(spec)) {
    const w = data.worlds[key];
    assert.deepEqual([w.name, w.tagline, w.problemLeft], [name, tagline, problemLeft], key);
    assert.equal(typeof w.revealLine, 'string', `${key} revealLine`);
    assert.ok(w.revealLine.length >= 40 && w.revealLine.length <= 120, `${key} revealLine is ${w.revealLine.length} chars`);
  }
});

// TASK-713: the Loom's five-year epilogue for each class grade band.
test('each grade band has a Loom epilogue for the End Screen (<= 140 chars)', () => {
  assert.deepEqual(Object.keys(data.grades).sort(), ['Fragile', 'SHUTDOWN', 'Stable', 'Thriving']);
  for (const [grade, text] of Object.entries(data.grades)) {
    assert.ok(typeof text === 'string' && text.length >= 40 && text.length <= 140, `${grade}: ${text && text.length} chars`);
  }
  assert.match(data.grades.SHUTDOWN, /zero/);
});
