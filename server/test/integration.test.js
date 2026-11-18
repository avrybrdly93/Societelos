'use strict';

// Integrated-build checks: the real engine with the real simulation, Loom
// (offline fallback), content and client modules, driven through whole games.

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const { GameState, NODE_IDS } = engine;

/**
 * Play cycles 1-4 with real phase timers shrunk to ~10 ms. `voteFor(cycle, i)`
 * returns [choice, override?] for node i. Resolves with everything emitted.
 */
function playFourCycles({ gameId = 'integration01', voteFor, phaseSeconds = {} } = {}) {
  const saved = { fast: process.env.FAST_TIMERS, secs: process.env.FAST_TIMER_SECONDS, key: process.env.GEMINI_API_KEY };
  process.env.FAST_TIMERS = 'true';
  process.env.FAST_TIMER_SECONDS = '0.01';
  delete process.env.GEMINI_API_KEY;
  const game = new GameState({ roomCode: 'INTG', phaseSeconds });
  for (const [k, v] of [['FAST_TIMERS', saved.fast], ['FAST_TIMER_SECONDS', saved.secs], ['GEMINI_API_KEY', saved.key]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  game.gameId = gameId;
  game.fixedRoot = 'ownership'; // the Who Owns the Loom? root of the crisis tree
  const out = { game, phases: [], resolutions: [], reveals: [], scores: [], roles: {} };
  const log = console.log;
  console.log = () => {};
  NODE_IDS.forEach((node, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(node, true); });
  game.on('role:assigned', ({ node, role }) => { out.roles[node] = role.key; });
  game.on('resolution', (r) => out.resolutions.push(r));
  game.on('world:reveal', (w) => out.reveals.push(w));
  game.on('score:update', (s) => out.scores.push(s));
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => { game.clearPhaseTimer(); console.log = log; reject(new Error(`stalled: ${out.phases.slice(-3)}`)); }, 15000);
    game.on('phase', (p) => {
      out.phases.push(p);
      if (p.phase === 'VOTE') NODE_IDS.forEach((n, i) => { const [c, o] = voteFor(p.cycle, i); game.castVote(n, c, !!o); });
      if (p.cycle === 5 || p.phase === 'END') {
        clearTimeout(guard);
        game.clearPhaseTimer();
        console.log = log;
        resolve(out);
      }
    });
    game.startIntroPhase();
  });
}

test('integration: gameEngine + server/sim (real simulate, state carried across cycles)', async () => {
  const out = await playFourCycles({ voteFor: (cycle, i) => [i < 3 ? 'A' : 'B'] });
  assert.equal(out.resolutions.length, 4);
  let gdw = engine.STARTING_GDW;
  for (const r of out.resolutions) {
    assert.equal(r.result.previousGdw, gdw, 'each cycle starts where the last ended');
    assert.equal(r.gdw, Math.round(r.realized.finalGdw * 10) / 10, 'GDW comes from the realized run');
    assert.ok(!r.realized.gdw.stub && r.forecast.median.length === 13);
    gdw = r.gdw;
  }
  assert.equal(out.game.gdwHistory.length, 1 + 4 * 12);
  assert.ok(out.game.simState && out.game.simState.traits.length === 120, '20 cohorts x 6 traits');
});

test('integration: gameEngine + server/loom.js (offline narration on every resolution)', async () => {
  const citizens = require('../../data/citizens.json');
  const out = await playFourCycles({ gameId: 'integration02', voteFor: (cycle) => [cycle === 2 ? 'B' : 'A'] });
  for (const r of out.resolutions) {
    assert.ok(typeof r.loomLine === 'string' && r.loomLine.length > 0 && r.loomLine.length <= 200);
    assert.ok(r.messages.length >= 1 && r.messages.length <= 10);
    const ids = r.messages.map((m) => m.citizenId);
    assert.equal(new Set(ids).size, ids.length, 'distinct citizens');
    for (const m of r.messages) {
      const c = citizens.find((x) => x.id === m.citizenId);
      assert.ok(c, m.citizenId);
      assert.equal(m.name, c.name, 'engine enriches reactions with the citizen card');
      assert.ok(m.text.length <= 140);
    }
  }
});

test('integration: data/crises.json worlds AA and AB drive cycles 3-4', () => {
  const data = engine.loadGameData();
  // On the crisis tree, cycle 4 follows the cycle 3 decision (here A).
  const expected = { AA: ['aa-purpose-drift', 'aa-robot-art'], AB: ['ab-the-pods', 'ab-curated-bonds'] };
  for (const [world, ids] of Object.entries(expected)) {
    [3, 4].forEach((cycle, i) => {
      const votes = { 1: world[0], 2: world[1], 3: 'A' };
      const crisis = engine.selectCrisis(data.crises, cycle, world, data.roles, false, { root: 'ownership', votes, used: [] });
      assert.equal(crisis.id, ids[i]);
      assert.equal(crisis.mode, 'binary');
      assert.ok(crisis.incident && crisis.loomIntro, `${crisis.id} has incident and Loom intro`);
      assert.deepEqual(Object.keys(crisis.intel).sort(), ['artisan', 'assimilator', 'catalyst', 'ghost', 'lotus'], `${crisis.id} intel`);
      for (const key of ['A', 'B']) {
        const o = crisis.options[key];
        assert.ok(o.name && o.text && o.roles.length >= 1, `${crisis.id} ${key}`);
        assert.equal(Object.keys(o.effects).length, 6);
      }
    });
  }
});

/** Assertions shared by the AA and AB playthroughs. */
function checkWorldRun(out, world, crisisIds) {
  const { game } = out;
  assert.equal(game.worldKey, world);
  assert.equal(out.reveals.length, 1);
  assert.equal(out.reveals[0].worldKey, world);
  const incidents = out.phases.filter((p) => p.phase === 'INCIDENT').map((p) => `${p.cycle}:${p.crisis && p.crisis.id}`);
  assert.deepEqual(incidents.slice(2, 4), [`3:${crisisIds[0]}`, `4:${crisisIds[1]}`]);
  assert.equal(out.resolutions.length, 4);
  assert.ok(out.phases.findIndex((p) => p.phase === 'WORLD_REVEAL') > out.phases.findIndex((p) => p.cycle === 2 && p.phase === 'RESOLUTION'));
}

test('integration: headless 4-cycle playthrough on the AA (Commonwealth) branch', async () => {
  const out = await playFourCycles({ gameId: 'playthroughAA', voteFor: () => ['A'] });
  checkWorldRun(out, 'AA', ['aa-purpose-drift', 'aa-robot-art']);
  assert.equal(out.game.volatility, 1.5, 'The Assembly (2A) made the rest of the game volatile');
});

test('integration: headless 4-cycle playthrough on the AB (Benevolent Machine) branch', async () => {
  const out = await playFourCycles({ gameId: 'playthroughAB', voteFor: (cycle) => [cycle === 2 ? 'B' : 'A'] });
  checkWorldRun(out, 'AB', ['ab-the-pods', 'ab-curated-bonds']);
  assert.equal(out.game.volatility, 1, 'Delegated Control keeps normal volatility');
  // Crisis 2B after 1A: the Loom governs, with the assimilator tag.
  assert.deepEqual(out.resolutions[1].result.governance, { holder: 'loom', line: 'The Loom will govern on your behalf.' });
});

test('integration: Override counts double, is spent once, and a 3-3 tie goes to the higher forecast', async () => {
  // Cycle 1: NODE-01 votes A with its Override, NODE-02 A, three B -> 3-3.
  // Cycle 2: NODE-01 tries a second Override (rejected, so it abstains).
  const out = await playFourCycles({
    gameId: 'overridetie1',
    voteFor: (cycle, i) => (cycle === 1 ? [i < 2 ? 'A' : 'B', i === 0] : cycle === 2 && i === 0 ? ['A', true] : ['B'])
  });
  const [r1, r2] = out.resolutions.map((r) => r.result);
  assert.deepEqual(r1.totals, { A: 3, B: 3 });
  assert.equal(r1.tie, true);
  // Recompute the Loom's tie-break independently from the same seed and state.
  const sim = require('../sim');
  const data = engine.loadGameData();
  const crisis = engine.selectCrisis(data.crises, 1, null, data.roles);
  const start = sim.createInitialState(data.sim);
  const seed = engine.hashSeed('overridetie1', 1);
  const median = (key) => sim.simulate({ simState: start }, crisis.options[key].effects, { runs: 500, seed, volatility: 1 }).forecast.median[12];
  assert.equal(r1.winner, median('B') > median('A') ? 'B' : 'A');
  // The spent Override is refused next cycle: NODE-01 abstains, nobody learns why.
  assert.equal(out.game.overrideAvailable('NODE-01'), false);
  assert.equal(r2.abstained, 1);
  assert.deepEqual(r2.totals, { A: 0, B: 4 });
  assert.ok(!JSON.stringify(out.resolutions).includes('NODE-01'), 'no node named in any resolution');
});



test('integration: with GEMINI_API_KEY unset the game narrates offline and never touches the network', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network must not be used offline'); };
  try {
    const out = await playFourCycles({ gameId: 'offline00001', voteFor: (cycle) => [cycle === 1 ? 'A' : 'B'] });
    assert.equal(calls, 0, 'no fetch attempted');
    assert.equal(out.resolutions.length, 4);
    for (const r of out.resolutions) {
      assert.ok(r.loomLine.length > 0, 'authored or template Loom line');
      assert.ok(r.messages.length > 0, 'citizen fallback lines');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** Play all 5 cycles to END on shrunk timers; phones write and rank in the finale. */
function playFiveCycles({ gameId, world = 'AA' }) {
  const saved = { fast: process.env.FAST_TIMERS, secs: process.env.FAST_TIMER_SECONDS };
  process.env.FAST_TIMERS = 'true';
  process.env.FAST_TIMER_SECONDS = '0.01';
  const game = new GameState({ roomCode: 'FIVE' });
  for (const [k, v] of [['FAST_TIMERS', saved.fast], ['FAST_TIMER_SECONDS', saved.secs]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  game.gameId = gameId;
  const out = { game, phases: [], resolutions: [] };
  const log = console.log;
  console.log = () => {};
  NODE_IDS.forEach((node, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(node, true); });
  game.on('resolution', (r) => out.resolutions.push(r));
  game.on('finale:ballot', ({ node, policies }) => setImmediate(() => game.rankPolicies(node, policies.map((p) => p.id))));
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => { game.stop(); console.log = log; reject(new Error(`stalled: ${out.phases.slice(-4).join(' ')}`)); }, 20000);
    game.on('phase', (p) => {
      out.phases.push(`${p.cycle}:${p.phase}`);
      if (p.phase === 'VOTE') NODE_IDS.forEach((n, i) => game.castVote(n, p.cycle <= 2 ? world[p.cycle - 1] : i < 3 ? 'A' : 'B'));
      if (p.phase === 'FINALE_WRITE') NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Council proposal number ${i + 1}`));
      if (p.phase === 'END') {
        clearTimeout(guard);
        setImmediate(() => { game.stop(); console.log = log; resolve(out); });
      }
    });
    game.startIntroPhase();
  });
}

test('full 5-cycle state machine on FAST_TIMERS: write-and-rank finale through to END', async () => {
  const loom = require('../loom');
  const original = loom.moderate;
  loom.moderate = async (subs) => subs.map((s, i) => ({ node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [['artisan'], ['lotus'], ['ghost'], ['assimilator'], []][i], effects: { purpose: 0.1 * i, connection: 0, health: 0.1, trust: 0, fairness: -0.1, autonomy: 0 } }));
  try {
    const out = await playFiveCycles({ gameId: 'fivecycles01', world: 'AA' });
    const five = out.phases.filter((p) => p.startsWith('5:'));
    assert.deepEqual(five, ['5:INCIDENT', '5:FINALE_WRITE', '5:FINALE_MOD', '5:FINALE_DEBATE', '5:FINALE_RANK', '5:FINALE_ENACT', '5:END']);
    assert.equal(out.resolutions.length, 5);
    const finale = out.resolutions[4].result;
    assert.equal(finale.finale, true);
    assert.equal(finale.enacted.length, 3);
    assert.equal(out.game.gdwHistory.length, 1 + 5 * 12);
  } finally {
    loom.moderate = original;
  }
});

test('full 5-cycle state machine on FAST_TIMERS: offline finale falls back to A/B and still ENDs', async () => {
  const out = await playFiveCycles({ gameId: 'fivecycles02', world: 'AB' });
  const five = out.phases.filter((p) => p.startsWith('5:'));
  assert.deepEqual(five, ['5:INCIDENT', '5:FINALE_WRITE', '5:FINALE_MOD', '5:DEBATE', '5:VOTE', '5:RESOLUTION', '5:END']);
  assert.equal(out.resolutions.length, 5);
  assert.ok(['A', 'B'].includes(out.resolutions[4].result.winner));
});

test('BA and BB world keys load their Cycle 3, 4 and 5 crises from data/crises.json', () => {
  const data = engine.loadGameData();
  const expected = {
    BA: ['ba-shadow-elite', 'ba-media-monopoly', 'ba-vote-to-seize'],
    BB: ['bb-scroll-extinction', 'bb-the-unplugged', 'bb-march-datacenter']
  };
  for (const [world, ids] of Object.entries(expected)) {
    [3, 4, 5].forEach((cycle, i) => {
      const votes = { 1: world[0], 2: world[1], 3: 'A' };
      const crisis = engine.selectCrisis(data.crises, cycle, world, data.roles, cycle === 5, { root: 'ownership', votes, used: [] });
      assert.equal(crisis.id, ids[i], `${world} cycle ${cycle}`);
      assert.equal(crisis.world, world);
      assert.equal(crisis.mode, cycle === 5 ? 'writein' : 'binary');
      assert.ok(crisis.options.A && crisis.options.B);
    });
    assert.equal(data.crises.worlds[world].finale, ids[2], 'world points at its finale');
  }
});
