'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');

const { GameState, NODE_IDS } = engine;

/** A seated 5-player game with the cycle's crisis loaded and voting open. */
function votingGame({ cycle = 1, voteHistory = {} } = {}) {
  const game = new GameState({ roomCode: 'TEST' });
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.forEach((node, i) => game.addPlayer(`socket-${i}`, `Student ${i + 1}`));
    game.startCycle(1);
    game.cycle = cycle;
    game.voteHistory = { ...voteHistory };
    game.crisis = engine.selectCrisis(game.data.crises, cycle, null, game.data.roles);
  } finally {
    console.log = log;
  }
  game.phase = engine.PHASES.VOTE;
  game.votingOpen = true;
  return game;
}

/** Cast `choices` ([choice, override?] per node in NODE_IDS order). */
function cast(game, choices) {
  choices.forEach(([choice, override], i) => {
    const res = game.castVote(NODE_IDS[i], choice, !!override);
    assert.ok(res.ok, `vote ${i} rejected: ${res.reason}`);
  });
}

test('weighted vote count with no Overrides: each vote counts 1', () => {
  const game = votingGame();
  cast(game, [['A'], ['A'], ['A'], ['B'], ['B']]);
  const { totals, winner, tie } = game.tallyVotes();
  assert.deepEqual(totals, { A: 3, B: 2 });
  assert.equal(winner, 'A');
  assert.equal(tie, false);
});

test('weighted vote count with one Override: it counts 2 and can flip the result', () => {
  const game = votingGame();
  cast(game, [['A'], ['A'], ['B', true], ['B'], ['B']]);
  const { totals, winner } = game.tallyVotes();
  assert.deepEqual(totals, { A: 2, B: 4 });
  assert.equal(winner, 'B');

  const tied = votingGame();
  cast(tied, [['A', true], ['A'], ['B'], ['B'], ['B']]);
  assert.deepEqual(tied.tallyVotes().totals, { A: 3, B: 3 });
  assert.equal(tied.tallyVotes().tie, true);
});

test('weighted vote count with multiple Overrides', () => {
  const game = votingGame();
  cast(game, [['A', true], ['A', true], ['B', true], ['B'], ['B']]);
  assert.deepEqual(game.tallyVotes().totals, { A: 4, B: 4 });

  const all = votingGame();
  cast(all, [['A', true], ['B', true], ['B', true], ['B', true], ['B', true]]);
  assert.deepEqual(all.tallyVotes().totals, { A: 2, B: 8 });
});

test('an Override can only be spent once per game', () => {
  const game = votingGame();
  assert.equal(game.overrideAvailable('NODE-01'), true);
  assert.ok(game.castVote('NODE-01', 'A', true).ok);
  assert.equal(game.overrideAvailable('NODE-01'), false);
  // Next cycle: a second Override is rejected, a normal vote is accepted.
  game.votes = {};
  assert.deepEqual(game.castVote('NODE-01', 'B', true), { ok: false, reason: 'OVERRIDE_SPENT' });
  assert.ok(game.castVote('NODE-01', 'B', false).ok);
  assert.equal(game.votes['NODE-01'].override, false);
});

test('Loom tie-breaker selects the option with the higher forecast median GDW', () => {
  const sim = (end) => ({ forecast: { median: [25, 26, end] } });
  assert.equal(engine.breakTie(sim(30), sim(31)), 'B');
  assert.equal(engine.breakTie(sim(31), sim(30)), 'A');
  // Identical medians fall back to A deterministically.
  assert.equal(engine.breakTie(sim(30), sim(30)), 'A');
});

test('a 3-3 tie resolves to the option with the higher forecast median', async () => {
  const game = votingGame();
  cast(game, [['A', true], ['A'], ['B'], ['B'], ['B']]);
  const medianA = engine.forecastMedianEnd(game.runSimulation('A'));
  const medianB = engine.forecastMedianEnd(game.runSimulation('B'));
  const expected = medianB > medianA ? 'B' : 'A';
  const log = console.log;
  console.log = () => {};
  try {
    const resolution = await game.startResolutionPhase();
    assert.equal(resolution.result.tie, true);
    assert.equal(resolution.result.winner, expected);
    assert.equal(game.voteHistory[1], expected);
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
});

/** Resolve the current cycle with every node voting `choice`. */
async function resolveWith(game, choice) {
  game.phase = engine.PHASES.VOTE;
  game.votingOpen = true;
  game.votes = {};
  game.simCache = {};
  cast(game, NODE_IDS.map(() => [choice]));
  const log = console.log;
  console.log = () => {};
  try {
    return await game.startResolutionPhase();
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
}

test('worldKey is vote1 + vote2 across all 4 combinations', async () => {
  assert.equal(engine.computeWorldKey('A', 'B'), 'AB');
  assert.equal(engine.computeWorldKey('A', null), null);
  for (const key of ['AA', 'AB', 'BA', 'BB']) {
    const game = votingGame({ cycle: 1 });
    await resolveWith(game, key[0]);
    assert.equal(game.worldKey, null, 'world is unknown after cycle 1');
    game.cycle = 2;
    game.crisis = engine.selectCrisis(game.data.crises, 2, null, game.data.roles);
    await resolveWith(game, key[1]);
    assert.equal(game.worldKey, key);
    assert.equal(game.worldInfo().name, game.data.crises.worlds[key].name);
  }
});

test('Crisis 2B applies assimilator in the AB world and lotus in the BB world', async () => {
  for (const [vote1, tag] of [['A', 'assimilator'], ['B', 'lotus']]) {
    const game = votingGame({ cycle: 1 });
    game.assignRoles(game.data.roles);
    await resolveWith(game, vote1);
    game.cycle = 2;
    game.crisis = engine.selectCrisis(game.data.crises, 2, null, game.data.roles);
    const raw = game.data.crises.crises.find((c) => c.id === game.crisis.id).options.B;
    assert.deepEqual(game.rolesFor('B'), [tag]);
    assert.deepEqual(game.effectsFor('B'), raw.effectsByWorld[vote1]);

    const holder = Object.keys(game.roleAssignment).find((n) => game.roleAssignment[n].key === tag);
    const before = game.scores[holder];
    await resolveWith(game, 'B');
    assert.equal(game.worldKey, `${vote1}B`);
    assert.equal(game.scores[holder], before + 1, `${tag} scores in ${vote1}B`);
    assert.deepEqual(game.scoreLedger[1].role, { [holder]: 1 });
  }
});

/** The node holding the Catalyst role in a game with roles dealt. */
function catalystGame() {
  const game = votingGame();
  game.assignRoles(game.data.roles);
  const node = Object.keys(game.roleAssignment).find((n) => game.roleAssignment[n].key === 'catalyst');
  return { game, node };
}

test('Catalyst scores +1 on a -10 GDW drop (GDW > 0) and 0 on a -9.9 drop', () => {
  assert.equal(engine.catalystScores(35, 25), true);
  assert.equal(engine.catalystScores(25, 35), true, 'a +10 rise counts too');
  assert.equal(engine.catalystScores(35, 25.1), false);
  assert.equal(engine.catalystScores(30.3, 20.3), true, 'float noise does not hide a 10.0 swing');

  const { game, node } = catalystGame();
  assert.deepEqual(game.awardCatalystPoints(35, 25), { [node]: 1 });
  assert.equal(game.scores[node], 1);
  assert.deepEqual(game.awardCatalystPoints(35, 25.1), {});
  assert.equal(game.scores[node], 1);
});

test('Catalyst scores 0 when a 15 point drop reaches GDW 0 (Loom shutdown)', () => {
  assert.equal(engine.catalystScores(15, 0), false);
  const { game, node } = catalystGame();
  assert.deepEqual(game.awardCatalystPoints(15, 0), {});
  assert.equal(game.scores[node], 0);
});

test('realized GDW hitting 0 in Cycle 2 transitions straight to END', async () => {
  const game = votingGame({ cycle: 2, voteHistory: { 1: 'A' } });
  const zero = { forecast: { median: [25, 0] }, realized: { gdw: [12, 6, 0], finalGdw: 0, districts: [] }, finalState: null, summary: { realizedDelta: -12 } };
  game.runSimulation = () => zero;
  const phases = [];
  game.on('phase', (p) => phases.push(p.phase));
  await resolveWith(game, 'A');
  assert.equal(game.gdw, 0);
  assert.equal(game.ending, 'shutdown');
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(game.advancePhase(), engine.PHASES.END);
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
  assert.deepEqual(phases, ['RESOLUTION', 'END'], 'no WORLD_REVEAL or further cycles');
  assert.equal(game.phase, 'END');
});

test('intel:drop delivers world-specific intel for Cycles 3 and 4', () => {
  const crises = engine.loadGameData().crises.crises;
  for (const world of ['AA', 'AB', 'BA', 'BB']) {
    for (const cycle of [3, 4]) {
      const raw = crises.find((c) => c.world === world && c.cycle === cycle);
      assert.ok(raw, `no crisis for ${world} cycle ${cycle}`);
      const game = votingGame();
      game.assignRoles(game.data.roles);
      game.cycle = cycle;
      game.worldKey = world;
      const drops = {};
      game.on('intel:drop', ({ node, text }) => { drops[node] = text; });
      game.startIncidentPhase();
      assert.equal(game.crisis.id, raw.id);
      game.startIntelDropPhase();
      game.clearPhaseTimer();
      assert.equal(Object.keys(drops).length, 5);
      for (const [node, role] of Object.entries(game.roleAssignment)) {
        const authored = raw.intel && raw.intel[role.key];
        // Authored world intel when present; otherwise the generic fallback (content pending).
        if (authored) assert.equal(drops[node], authored, `${raw.id} ${role.key}`);
        else assert.ok(drops[node].length > 0);
      }
    }
  }
});
