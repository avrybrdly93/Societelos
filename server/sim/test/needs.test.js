'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sim = require('../index');
const { createInitialState: createSimState } = require('../state');
const data = require('../../../data/sim.json');

test('currentNeeds returns the 50/50 wellness breakdown, 0-100', () => {
  const needs = sim.currentNeeds(createSimState(data));
  assert.strictEqual(needs.tiers.length, 5);
  assert.deepStrictEqual(needs.tiers.map((t) => t.weight), [0.488, 0.296, 0.152, 0.056, 0.008]);
  for (const t of needs.tiers) {
    assert.ok(t.raw >= 0 && t.raw <= 100 && t.effective >= 0 && t.effective <= t.raw + 1e-9, t.name);
  }
  assert.strictEqual(needs.tiers[0].effective, needs.tiers[0].raw, 'E1 = S1');
  for (const k of ['autonomy', 'competence', 'relatedness']) assert.ok(needs.sdt[k] >= 0 && needs.sdt[k] <= 100, k);
  assert.ok(Math.abs(needs.wellness - (0.5 * needs.maslow + 0.5 * needs.sdtScore)) < 0.15, 'wellness is the 50/50 blend');
});

test('prepotency cascade: a weak foundation pinches every tier above it', () => {
  const { wellnessParts, wellnessSpec } = require('../state');
  const spec = wellnessSpec(data);
  const idx = (n) => data.traits.indexOf(n);
  const strong = data.traits.map(() => 0.8);
  const weak = strong.slice(); weak[idx('health')] = 0.2;
  const a = wellnessParts(strong, 0, spec);
  const b = wellnessParts(weak, 0, spec);
  assert.ok(b.E[1] < a.E[1] && b.E[4] < a.E[4], 'higher tiers lose support');
  assert.strictEqual(b.S[1], a.S[1], 'raw potential is unchanged');
  assert.ok(Math.abs(a.E[1] - a.S[1] * Math.sqrt(a.E[0])) < 1e-12, 'E_i = S_i * E_{i-1}^0.5');
});

test('realized run carries a needs snapshot per month', () => {
  const state = createSimState(data);
  const r = sim.simulate({ gdw: 25, simState: state }, {}, { runs: 5, seed: 7 });
  assert.strictEqual(r.realized.needs.length, r.realized.gdw.length);
  assert.ok(typeof r.realized.needs[12].wellness === 'number');
});
