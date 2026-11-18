'use strict';

// Role Tag Balance Pass (TASK-701..707) over the 28 authored options a game
// can reach in data/crises.json. See scripts/tag-balance.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const data = require('../../data/crises.json');
const { balanceReport, scopeOptions, TAG_ROLES } = require('../../scripts/tag-balance');

test('the pass covers exactly 28 authored options', () => {
  assert.equal(balanceReport(data).optionCount, 28);
});

test('every option carries 1-2 known role tags, never the Catalyst', () => {
  for (const scope of ['fixed', 'AA', 'AB', 'BA', 'BB']) {
    for (const o of scopeOptions(data, scope)) {
      const label = `${o.id} ${o.key}${o.variant ? `/${o.variant}` : ''}`;
      assert.ok(o.tags.length >= 1 && o.tags.length <= 2, `${label}: ${o.tags.length} tags`);
      assert.equal(new Set(o.tags).size, o.tags.length, `${label}: duplicate tag`);
      for (const t of o.tags) assert.ok(TAG_ROLES.includes(t), `${label}: unknown tag ${t}`);
    }
  }
});

// TASK-702: Cycles 1-2. Whatever Cycle 1 decides (which also picks the
// Crisis 2B variant), every tag-scoring role has at least one option it can
// win with across the two fixed crises, and nobody gets more than 2.
test('fixed Cycles 1-2: every path gives each role 1-2 early scoring options', () => {
  const { paths } = balanceReport(data);
  for (const [path, counts] of Object.entries(paths)) {
    for (const role of TAG_ROLES) {
      assert.ok(counts[role] >= 1 && counts[role] <= 2, `path ${path}: ${role} has ${counts[role]} options`);
    }
  }
});

// TASK-703..706: Cycles 3-5 of each world (2 binaries + finale fallback = 6
// options). Each of the 4 tag-scoring roles is tagged exactly 3 times.
function assertWorldBalanced(world) {
  const { counts } = balanceReport(data).scopes[world];
  assert.deepEqual(counts, { artisan: 3, lotus: 3, assimilator: 3, ghost: 3 }, `world ${world}`);
}

test('world AA (The Commonwealth): each role tagged 3 times across its 6 options', () => assertWorldBalanced('AA'));
test('world AB (The Benevolent Machine): each role tagged 3 times across its 6 options', () => assertWorldBalanced('AB'));
