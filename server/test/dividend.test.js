'use strict';

// Fixed Crisis 1, The Commons: a Cycle 1 penalty that pays out later as
// Public Dividends (delayed Social Satisfaction bonus in cycles 3-5).

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../gameEngine');
const sim = require('../sim');

const data = engine.loadGameData();
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };

function game(vote1, firstId = 'fixed-1-ownership') {
  const g = quiet(() => new engine.GameState({ data }));
  g.voteHistory = { 1: vote1 };
  g.crisisPath = [{ cycle: 1, id: firstId }];
  g.treeRoot = 'ownership';
  return g;
}

test('The Commons text and Loom lines explain the sabotage, lawsuits and the later payoff', () => {
  const a = data.crises.crises.find((c) => c.id === 'fixed-1-ownership').options.A;
  assert.match(a.text, /sabotage/i);
  assert.match(a.text, /lawsuits/i);
  assert.match(a.text, /later cycles/i);
  for (const k of ['good', 'mixed', 'bad']) {
    assert.match(a.loomLines[k], /sabotaged the grid/i, k);
    assert.match(a.loomLines[k], /lawsuits/i, k);
    assert.match(a.loomLines[k], /dividends/i, k);
  }
  assert.equal(a.targetGdwDelta, -5);
});

test('dividend fires only after choosing The Commons, in cycles 3-5', () => {
  const g = game('A');
  const pts = [1, 2, 3, 4, 5].map((c) => { const d = g.dividendFor(c); return d ? d.points : 0; });
  assert.deepEqual(pts, [0, 0, 3, 4, 4]);
  assert.ok(pts.reduce((a, b) => a + b, 0) >= 9 && pts.reduce((a, b) => a + b, 0) <= 12);
  const b = game('B');
  for (const c of [1, 2, 3, 4, 5]) assert.equal(b.dividendFor(c), null);
});

test('dividend effects raise the forecast median by about the stated points', () => {
  const g = game('A');
  g.cycle = 3;
  const state = sim.createInitialState(data.sim);
  const base = sim.simulate({ gdw: 25, simState: state }, {}, { runs: 200, seed: 5 }).forecast.median[12];
  const boosted = sim.simulate({ gdw: 25, simState: state }, g.simEffects({}), { runs: 200, seed: 5 }).forecast.median[12];
  assert.ok(boosted - base > 2.4 && boosted - base < 3.6, `delta ${boosted - base}`);
  assert.equal(g.dividendNote().points, 3);
  assert.match(g.dividendNote().line, /Public Dividends active: \+3 Social Satisfaction/);
});
