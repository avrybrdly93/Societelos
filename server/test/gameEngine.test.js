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

test('RESOLUTION waits the full animation duration after the payload is sent', async () => {
  const game = votingGame();
  const start = Date.now();
  const resolution = await resolveWith(game, 'A');
  const full = game.durations.RESOLUTION;
  assert.ok(typeof resolution.endsAt === 'number');
  assert.ok(resolution.endsAt - start >= full - 50, 'next INCIDENT not before the animation ends');
});

test('resetGame() clears cycle counters, Overrides, scores and volatility', async () => {
  const game = votingGame({ cycle: 2, voteHistory: { 1: 'A' } });
  game.assignRoles(game.data.roles);
  game.castVote('NODE-01', 'A', true);
  assert.equal(game.overrideAvailable('NODE-01'), false);
  game.scores['NODE-02'] = 3;
  await resolveWith(game, 'A');
  assert.equal(game.volatility, 1.5);
  assert.equal(game.worldKey, 'AA');
  const oldId = game.gameId;

  const log = console.log;
  console.log = () => {};
  try {
    game.resetGame();
  } finally {
    console.log = log;
  }
  assert.equal(game.phase, 'LOBBY');
  assert.equal(game.cycle, 0);
  assert.notEqual(game.gameId, oldId);
  assert.equal(game.volatility, 1);
  assert.equal(game.worldKey, null);
  assert.equal(game.ending, null);
  assert.deepEqual(game.voteHistory, {});
  assert.deepEqual(game.scoreLedger, []);
  assert.deepEqual(game.gdwHistory, []);
  assert.equal(game.gdw, engine.STARTING_GDW);
  assert.equal(game.endsAt, null);
  for (const node of NODE_IDS) {
    assert.equal(game.scores[node], 0);
    assert.equal(game.overrideAvailable(node), true);
    assert.equal(game.players[node].ready, false);
    assert.equal(game.players[node].role, null);
  }
});

test('FAST_TIMERS=true drives Cycle 1 -> Cycle 4 automatically', async () => {
  assert.equal(engine.buildPhaseDurations({ FAST_TIMERS: 'true' }).DEBATE, 3000);
  const saved = { fast: process.env.FAST_TIMERS, secs: process.env.FAST_TIMER_SECONDS };
  process.env.FAST_TIMERS = 'true';
  process.env.FAST_TIMER_SECONDS = '0.01';
  const game = new GameState({ roomCode: 'FAST' });
  Object.assign(process.env, { FAST_TIMERS: saved.fast, FAST_TIMER_SECONDS: saved.secs });
  if (saved.fast === undefined) delete process.env.FAST_TIMERS;
  if (saved.secs === undefined) delete process.env.FAST_TIMER_SECONDS;
  assert.equal(game.durations.VOTE, 10);
  game.gameId = 'fastflow0001'; // fixed seeds: the run is reproducible

  const log = console.log;
  console.log = () => {};
  const seen = [];
  try {
    NODE_IDS.forEach((node, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(node, true); });
    await new Promise((resolve, reject) => {
      const guard = setTimeout(() => reject(new Error(`stalled at ${seen.slice(-3).join(' -> ')}`)), 10000);
      game.on('phase', (p) => {
        seen.push(`${p.cycle}:${p.phase}`);
        // Cycle 1 and 2 vote A/B -> world AB; later cycles vote by majority.
        if (p.phase === 'VOTE') NODE_IDS.forEach((n, i) => game.castVote(n, p.cycle === 2 ? 'B' : i < 3 ? 'A' : 'B'));
        if (p.cycle === 5 || p.phase === 'END') { clearTimeout(guard); game.clearPhaseTimer(); resolve(); }
      });
      game.startIntroPhase();
    });
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
  for (const cycle of [1, 2, 3, 4]) {
    for (const phase of ['INCIDENT', 'INTEL', 'DEBATE', 'VOTE', 'RESOLUTION']) {
      assert.ok(seen.includes(`${cycle}:${phase}`), `missing ${cycle}:${phase}`);
    }
  }
  assert.ok(seen.indexOf('2:WORLD_REVEAL') > seen.indexOf('2:RESOLUTION'));
  assert.ok(seen.indexOf('3:INCIDENT') > seen.indexOf('2:WORLD_REVEAL'));
  assert.deepEqual(game.voteHistory, { 1: 'A', 2: 'B', 3: 'A', 4: 'A' });
  assert.equal(game.worldKey, 'AB');
  assert.equal(game.gdwHistory.length, 1 + 4 * 12);
});

test('resolution payload matches the socket specification table', async () => {
  const game = votingGame();
  const resolution = JSON.parse(JSON.stringify(await resolveWith(game, 'A'))); // as sent over the wire
  const spec = ['result', 'gdw', 'forecast', 'realized', 'districts', 'loomLine', 'messages'];
  for (const key of spec) assert.ok(key in resolution, `missing ${key}`);
  // Only documented additions beyond the table: the restarted RESOLUTION endsAt.
  assert.deepEqual(Object.keys(resolution).filter((k) => !spec.includes(k)), ['endsAt']);

  assert.equal(resolution.result.winner, 'A');
  assert.equal(typeof resolution.gdw, 'number');
  for (const band of ['median', 'p5', 'p95']) {
    assert.ok(Array.isArray(resolution.forecast[band]) && resolution.forecast[band].length === 13, band);
  }
  assert.ok(Array.isArray(resolution.realized.gdw) && resolution.realized.gdw.length === 13);
  assert.ok(Array.isArray(resolution.districts));
  assert.ok(typeof resolution.loomLine === 'string' && resolution.loomLine.length > 0);
  assert.ok(Array.isArray(resolution.messages));
  for (const m of resolution.messages) assert.ok(typeof m.citizenId === 'string' && typeof m.text === 'string');
  // Secrets never ride along.
  const wire = JSON.stringify(resolution);
  for (const secret of ['"effects"', '"roles"', '"override"', '"votes"', '"token"']) assert.ok(!wire.includes(secret), secret);
});

test('resolution districts carry per-month wellbeing for all 5 districts', async () => {
  const game = votingGame();
  const { districts } = await resolveWith(game, 'A');
  assert.equal(districts.length, 13, 'month 0 (start) through month 12');
  for (const month of districts) {
    assert.deepEqual(Object.keys(month).sort(), ['D1', 'D2', 'D3', 'D4', 'D5']);
    for (const w of Object.values(month)) assert.ok(Number.isFinite(w) && w >= 0 && w <= 1);
  }
});

test('loom.narrate failures never reject: the resolution falls back safely', async () => {
  const loom = require('../loom');
  const original = loom.narrate;
  try {
    for (const bad of [async () => { throw new Error('boom'); }, async () => null, async () => ({ messages: [] })]) {
      loom.narrate = bad;
      const game = votingGame();
      const resolution = await resolveWith(game, 'B');
      assert.ok(resolution, 'resolution still emitted');
      assert.ok(typeof resolution.loomLine === 'string' && resolution.loomLine.length > 0);
    }
    // A listener that throws is caught too (the returned promise resolves to null).
    loom.narrate = original;
    const game = votingGame();
    game.on('resolution', () => { throw new Error('listener failed'); });
    const err = console.error;
    console.error = () => {};
    try {
      assert.equal(await resolveWith(game, 'A'), null);
    } finally {
      console.error = err;
    }
  } finally {
    loom.narrate = original;
  }
});

test('DEBATE/VOTE payloads keep role tags hidden so players must infer them', () => {
  const game = votingGame();
  const payloads = [];
  game.on('phase', (p) => payloads.push(JSON.parse(JSON.stringify(p))));
  game.startDebatePhase();
  game.startBlindVotePhase();
  game.clearPhaseTimer();
  for (const p of payloads) {
    const wire = JSON.stringify(p);
    for (const secret of ['"roles"', '"rolesByWorld"', '"effects"', '"effectsByWorld"', 'artisan', 'assimilator', 'catalyst', 'ghost']) {
      assert.ok(!wire.includes(secret), `${p.phase} leaks ${secret}`);
    }
  }
  assert.ok(payloads[0].options.A.text.length > 0, 'policy text is public');
});

test('WORLD_REVEAL lasts 10 seconds and then advances to the Cycle 3 incident', () => {
  assert.equal(engine.DEFAULT_PHASE_SECONDS.WORLD_REVEAL, 10);
  const game = votingGame({ cycle: 2, voteHistory: { 1: 'A', 2: 'B' } });
  game.worldKey = 'AB';
  game.phase = engine.PHASES.RESOLUTION;
  const phases = [];
  game.on('phase', (p) => phases.push(p));
  const log = console.log;
  console.log = () => {};
  try {
    const before = Date.now();
    assert.equal(game.advancePhase(), 'WORLD_REVEAL');
    const reveal = phases[0];
    assert.equal(reveal.phase, 'WORLD_REVEAL');
    assert.ok(Math.abs(reveal.endsAt - before - 10000) < 100, 'host and phones count down 10 s');
    assert.equal(reveal.world.worldKey, 'AB');
    // When the timer expires, both screens leave the takeover for cycle 3.
    assert.equal(game.advancePhase(), 'INCIDENT');
    assert.equal(game.cycle, 3);
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
  // The reveal animation itself (CSS) finishes well inside the 10 s beat.
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public', 'css', 'styles.css'), 'utf8');
  const m = css.match(/\.view-world\.is-active \.world-name \{ animation: world-in ([\d.]+)s/);
  assert.ok(m && Number(m[1]) < 10, 'world-in animation shorter than the beat');
});

test('Cycle 5 detects a writein crisis and starts the write-and-rank finale', () => {
  const game = votingGame();
  game.worldKey = 'AA';
  game.cycle = 5;
  const log = console.log;
  console.log = () => {};
  try {
    game.startIncidentPhase();
    game.clearPhaseTimer();
  } finally {
    console.log = log;
  }
  assert.equal(game.crisis.mode, 'writein');
  assert.equal(game.finaleFallback, false);
  assert.equal(game.isFinaleWriteIn(), true);
  assert.deepEqual(game.finale.submissions, {});
  // A cycle-5 crisis that is not a write-in plays as a binary vote.
  game.crisis = { ...game.crisis, mode: 'binary' };
  console.log = () => {};
  try { game.initFinale(); } finally { console.log = log; }
  assert.equal(game.isFinaleWriteIn(), false);
});

/** A game sitting at the cycle 5 INCIDENT of world `world`, real durations. */
function finaleGame(world = 'AA') {
  const game = votingGame();
  game.gameId = `finale-${world}-0001`; // reproducible shuffles and defaults
  game.assignRoles(game.data.roles);
  game.worldKey = world;
  game.voteHistory = { 1: world[0], 2: world[1], 3: 'A', 4: 'A' };
  game.cycle = 5;
  const log = console.log;
  console.log = () => {};
  try { game.startIncidentPhase(); } finally { console.log = log; }
  return game;
}

/** Run `fn` with console.log silenced. */
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

test('finale INCIDENT (15 s, no options) advances to FINALE_WRITE (45 s)', () => {
  const game = finaleGame();
  const phases = [];
  game.on('phase', (p) => phases.push(p));
  quiet(() => game.enterPhase(engine.PHASES.INCIDENT));
  assert.equal(phases[0].endsAt - Date.now() <= 15000 && phases[0].endsAt - Date.now() > 14000, true);
  assert.ok(!('options' in phases[0]), 'no options during the finale incident');
  quiet(() => game.advancePhase());
  game.stop();
  const write = phases[1];
  assert.equal(write.phase, 'FINALE_WRITE');
  assert.ok(write.endsAt - Date.now() > 44000 && write.endsAt - Date.now() <= 45000);
  assert.deepEqual(write.finale, { maxLength: 140 });
  assert.equal(game.finale.writingOpen, true);
});

test('submitPolicy records one write-in per node during FINALE_WRITE only', () => {
  const game = finaleGame();
  assert.deepEqual(game.submitPolicy('NODE-01', 'Too early'), { ok: false, reason: 'WRITING_CLOSED' });
  quiet(() => game.startFinaleWritePhase());
  game.stop();
  assert.equal(game.submitPolicy('NODE-01', 'Every district elects a repair council.').ok, true);
  assert.deepEqual(game.submitPolicy('NODE-09', 'x'), { ok: false, reason: 'UNKNOWN_NODE' });
  assert.deepEqual(game.submittedNodes(), ['NODE-01']);
});

test('finale submissions are trimmed to 140 characters and must not be empty', () => {
  const game = finaleGame();
  quiet(() => game.startFinaleWritePhase());
  game.stop();
  assert.deepEqual(game.submitPolicy('NODE-01', '   \n  '), { ok: false, reason: 'EMPTY' });
  assert.equal(game.submittedNodes().length, 0);
  const long = `  ${'Give every district a citizens jury.  '.repeat(10)}`;
  const res = game.submitPolicy('NODE-02', long);
  assert.equal(res.ok, true);
  assert.ok(game.finale.submissions['NODE-02'].length <= 140);
  assert.ok(!/^\s|\s$|\s{2}/.test(game.finale.submissions['NODE-02']));
});

test('idle or disconnected players get a neutral default policy when FINALE_WRITE expires', () => {
  const game = finaleGame();
  quiet(() => game.startFinaleWritePhase());
  game.submitPolicy('NODE-01', 'Every district elects a repair council.');
  game.submitPolicy('NODE-03', 'Fund one public workshop per street.');
  game.markDisconnected && quiet(() => game.markDisconnected('NODE-05'));
  quiet(() => game.advancePhase()); // the 45 s timer expiring
  game.stop();
  assert.equal(game.phase, 'FINALE_MOD');
  assert.equal(game.finale.writingOpen, false);
  assert.deepEqual(game.finale.defaulted.sort(), ['NODE-02', 'NODE-04', 'NODE-05']);
  for (const n of ['NODE-02', 'NODE-04', 'NODE-05']) assert.equal(game.finale.submissions[n], engine.DEFAULT_FINALE_POLICY);
  assert.equal(game.finale.submissions['NODE-01'], 'Every district elects a repair council.');
  assert.equal(game.submitPolicy('NODE-02', 'late').reason, 'WRITING_CLOSED');
});

test('FINALE_WRITE advances to FINALE_MOD as soon as all 5 policies are in', async () => {
  const game = finaleGame();
  quiet(() => game.startFinaleWritePhase());
  const seen = [];
  game.on('phase', (p) => seen.push(p.phase));
  const log = console.log;
  console.log = () => {};
  try {
    NODE_IDS.slice(0, 4).forEach((n, i) => game.submitPolicy(n, `Policy number ${i + 1} for the council.`));
    await new Promise((r) => setImmediate(r));
    assert.equal(game.phase, 'FINALE_WRITE', 'still writing with 4 of 5');
    game.submitPolicy('NODE-05', 'Policy number 5 for the council.');
    await new Promise((r) => setImmediate(r));
    assert.equal(seen[0], 'FINALE_MOD', 'moved on without waiting for the timer');
    assert.deepEqual(game.finale.defaulted, []);
  } finally {
    game.stop();
    console.log = log;
  }
});

test('FINALE_MOD calls loom.moderate once with all 5 submissions (node ids and text only)', async () => {
  const loom = require('../loom');
  const original = loom.moderate;
  const calls = [];
  loom.moderate = async (subs, crisis, opts) => {
    calls.push({ subs, crisis, opts });
    return subs.map((s) => ({ node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: ['artisan'], effects: { purpose: 0.1, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: -0.1 } }));
  };
  try {
    const game = finaleGame();
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.slice(0, 3).forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    const results = await quiet(() => { game.clearPhaseTimer(); game.phase = 'FINALE_WRITE'; return game.startFinaleModPhase(); });
    game.stop();
    assert.equal(calls.length, 1, 'one batch call');
    assert.equal(calls[0].subs.length, 5);
    for (const sub of calls[0].subs) assert.deepEqual(Object.keys(sub).sort(), ['node', 'text']);
    assert.equal(calls[0].crisis.id, 'aa-fake-struggle');
    assert.equal(results.length, 5);
    assert.equal(Object.keys(game.finale.moderation).length, 5);
    assert.ok(game.finale.moderationMs >= 0);
  } finally {
    loom.moderate = original;
  }
});

test('if loom.moderate fails, cycle 5 falls back to the authored A/B finale (DEBATE -> VOTE)', async () => {
  const game = finaleGame();
  const phases = [];
  game.on('phase', (p) => phases.push(p.phase));
  quiet(() => game.startFinaleWritePhase());
  game.submitPolicy('NODE-01', 'Disclose everything.');
  // No API key in tests: loom.moderate returns fallback results.
  await quiet(() => { game.clearPhaseTimer(); return game.startFinaleModPhase(); });
  game.stop();
  assert.equal(game.finaleFallback, true);
  assert.deepEqual(phases.slice(-2), ['FINALE_MOD', 'DEBATE']);
  assert.equal(game.phase, 'DEBATE');
  assert.equal(game.nextPhase(), 'VOTE');
});

/** Replace loom.moderate for one test; returns a restore function. */
function stubModerate(fn) {
  const loom = require('../loom');
  const original = loom.moderate;
  loom.moderate = fn;
  return () => { loom.moderate = original; };
}
const okModeration = (roles = ['artisan']) => async (subs) => subs.map((s, i) => ({
  node: s.node, status: 'ok', cleaned: `Cleaned: ${s.text}`, feedback: '', roles,
  effects: { purpose: 0.1 * (i + 1), connection: 0, health: 0, trust: 0, fairness: -0.1, autonomy: 0 }
}));

/** Drive a finale game to the end of FINALE_MOD with all nodes writing. */
async function moderatedFinale(world = 'AA') {
  const game = finaleGame(world);
  quiet(() => game.startFinaleWritePhase());
  NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in from node ${i + 1}`));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return game;
}

test('when all 5 moderations come back ok, the finale moves straight to FINALE_DEBATE', async () => {
  const restore = stubModerate(okModeration());
  try {
    const seen = [];
    const game = finaleGame();
    game.on('phase', (p) => seen.push(p.phase));
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    game.stop();
    assert.deepEqual(seen, ['FINALE_WRITE', 'FINALE_MOD', 'FINALE_DEBATE']);
    assert.equal(game.finaleFallback, false);
    assert.equal(game.finale.policies.length, 5);
    for (const p of game.finale.policies) assert.ok(p.text.startsWith('Cleaned:') && p.roles[0] === 'artisan');
  } finally {
    restore();
  }
});

test('"revise" sends private finale:feedback to that author and opens a 25 s resubmit window', async () => {
  const restore = stubModerate(async (subs) => subs.map((s) => (s.node === 'NODE-02'
    ? { node: s.node, status: 'revise', cleaned: '', feedback: 'Name a policy, not a person.', roles: [], effects: {} }
    : { node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [], effects: { purpose: 0.1 } })));
  try {
    const game = finaleGame();
    const feedback = [];
    const phases = [];
    game.on('finale:feedback', (f) => feedback.push(f));
    game.on('phase', (p) => phases.push(p));
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(feedback, [{ node: 'NODE-02', status: 'revise', feedback: 'Name a policy, not a person.' }]);
    const window = phases[phases.length - 1];
    assert.equal(window.phase, 'FINALE_MOD');
    assert.equal(window.resubmit, true);
    assert.ok(window.endsAt - Date.now() > 24000 && window.endsAt - Date.now() <= 25000);
    assert.ok(!JSON.stringify(window).includes('Name a policy'), 'feedback never broadcast');
    assert.equal(game.finale.revise['NODE-02'], 'pending');
    game.stop();
  } finally {
    restore();
  }
});

test('only a node in "revise" may resubmit, once, during the FINALE_MOD window', async () => {
  const restore = stubModerate(async (subs) => subs.map((s) => ({ node: s.node, status: s.node === 'NODE-02' ? 'revise' : 'ok', cleaned: s.text, feedback: 'Rephrase.', roles: [], effects: {} })));
  try {
    const game = finaleGame();
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(game.resubmitPolicy('NODE-01', 'sneaky edit').reason, 'NOT_REVISING');
    assert.equal(game.resubmitPolicy('NODE-02', '   ').reason, 'EMPTY');
    assert.equal(game.resubmitPolicy('NODE-02', 'Every district elects a repair council.').ok, true);
    assert.equal(game.resubmitPolicy('NODE-02', 'second try').reason, 'ALREADY_RESUBMITTED');
    assert.equal(game.finale.submissions['NODE-02'], 'Every district elects a repair council.');
    game.stop();
  } finally {
    restore();
  }
});

test('a resubmission is moderated with loom.moderateOne, then the finale moves on', async () => {
  const loom = require('../loom');
  const restore = stubModerate(async (subs) => subs.map((s) => ({ node: s.node, status: s.node === 'NODE-02' ? 'revise' : 'ok', cleaned: s.text, feedback: 'Rephrase.', roles: [], effects: { purpose: 0.1 } })));
  const originalOne = loom.moderateOne;
  const oneCalls = [];
  loom.moderateOne = async (sub, crisis) => {
    oneCalls.push({ sub, crisis: crisis.id });
    return { node: sub.node, status: 'ok', cleaned: 'Every district elects a repair council.', feedback: '', roles: ['artisan'], effects: { purpose: 0.3 } };
  };
  try {
    const game = finaleGame();
    const phases = [];
    game.on('phase', (p) => phases.push(p.phase));
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    game.resubmitPolicy('NODE-02', 'every district picks repair crew');
    await game.finale.pending;
    game.stop();
    assert.deepEqual(oneCalls, [{ sub: { node: 'NODE-02', text: 'every district picks repair crew' }, crisis: 'aa-fake-struggle' }]);
    assert.equal(phases[phases.length - 1], 'FINALE_DEBATE');
    const p2 = game.finale.policies.find((p) => p.node === 'NODE-02');
    assert.equal(p2.text, 'Every district elects a repair council.');
    assert.deepEqual(p2.roles, ['artisan']);
  } finally {
    loom.moderateOne = originalOne;
    restore();
  }
});

test('loom.moderateOne rejects (bland placeholder) when the Loom is unavailable', async () => {
  const loom = require('../loom');
  const r = await loom.moderateOne({ node: 'NODE-03', text: 'x' }, {}, { config: { enabled: false } });
  assert.equal(r.status, 'reject');
  assert.equal(r.fallback, true);
});

test('"reject", a failed second attempt or a missed resubmit becomes a bland placeholder policy', async () => {
  const loom = require('../loom');
  const restore = stubModerate(async (subs) => subs.map((s) => ({
    node: s.node,
    status: { 'NODE-01': 'reject', 'NODE-02': 'revise', 'NODE-03': 'revise' }[s.node] || 'ok',
    cleaned: s.node === 'NODE-01' ? 'something awful' : s.text,
    feedback: 'Rephrase.', roles: ['ghost'], effects: { purpose: 0.5 }
  })));
  const originalOne = loom.moderateOne;
  loom.moderateOne = async (sub) => ({ node: sub.node, status: 'revise', cleaned: 'still bad', roles: ['lotus'], effects: { health: 1 } });
  try {
    const game = finaleGame();
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    game.resubmitPolicy('NODE-02', 'second attempt'); // moderated again as "revise" -> fails
    await game.finale.pending;
    // NODE-03 never resubmits: the 25 s window expires.
    quiet(() => game.advancePhase());
    game.stop();
    assert.equal(game.phase, 'FINALE_DEBATE');
    for (const node of ['NODE-01', 'NODE-02', 'NODE-03']) {
      const p = game.finale.policies.find((x) => x.node === node);
      assert.equal(p.text, engine.PLACEHOLDER_POLICY, node);
      assert.deepEqual(p.roles, []);
      assert.deepEqual(p.effects, { purpose: 0, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 });
    }
    assert.ok(!JSON.stringify(game.finale.policies).includes('something awful'));
    assert.equal(game.finale.policies.find((x) => x.node === 'NODE-04').text, 'Write-in 4');
  } finally {
    loom.moderateOne = originalOne;
    restore();
  }
});

test('finale policy ids POLICY-1..5 follow a deterministic shuffle, not node order', async () => {
  const restore = stubModerate(okModeration());
  try {
    const orders = [];
    for (const gameId of ['shuffle-a', 'shuffle-a', 'shuffle-b', 'shuffle-c']) {
      const game = finaleGame();
      game.gameId = gameId;
      quiet(() => game.startFinaleWritePhase());
      NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      game.stop();
      assert.deepEqual(game.finale.policies.map((p) => p.id), ['POLICY-1', 'POLICY-2', 'POLICY-3', 'POLICY-4', 'POLICY-5']);
      orders.push(game.finale.policies.map((p) => p.node).join());
    }
    assert.equal(orders[0], orders[1], 'same game id, same order');
    assert.ok(new Set(orders).size > 1, 'different games shuffle differently');
    assert.ok(orders.some((o) => o !== NODE_IDS.join()), 'not simply node order');
  } finally {
    restore();
  }
});

test('the policyId -> author map is stored server-side', async () => {
  const restore = stubModerate(okModeration());
  try {
    const game = await moderatedFinale();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    game.stop();
    assert.equal(Object.keys(game.finale.authors).length, 5);
    for (const p of game.finale.policies) assert.equal(game.finaleAuthor(p.id), p.node);
    assert.deepEqual(Object.values(game.finale.authors).sort(), [...NODE_IDS]);
    assert.equal(game.finaleAuthor('POLICY-9'), null);
  } finally {
    restore();
  }
});

test('FINALE_DEBATE broadcasts anonymised policies [{ id, text }] only', async () => {
  const restore = stubModerate(okModeration(['ghost', 'artisan']));
  try {
    const game = finaleGame();
    const phases = [];
    game.on('phase', (p) => phases.push(JSON.parse(JSON.stringify(p))));
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    game.stop();
    const debate = phases.find((p) => p.phase === 'FINALE_DEBATE');
    assert.equal(debate.policies.length, 5);
    for (const p of debate.policies) assert.deepEqual(Object.keys(p).sort(), ['id', 'text']);
    const wire = JSON.stringify(debate);
    for (const leak of ['NODE-0', 'ghost', 'artisan', 'effects', 'roles', 'authors']) assert.ok(!wire.includes(leak), leak);
  } finally {
    restore();
  }
});

test('FINALE_DEBATE (60 s) is followed by FINALE_RANK (30 s)', async () => {
  const restore = stubModerate(okModeration());
  try {
    const game = finaleGame();
    const phases = [];
    game.on('phase', (p) => phases.push(p));
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    const debate = phases[phases.length - 1];
    assert.equal(debate.phase, 'FINALE_DEBATE');
    assert.ok(debate.endsAt - Date.now() > 59000 && debate.endsAt - Date.now() <= 60000);
    quiet(() => game.advancePhase()); // the 60 s debate timer expiring
    const rank = phases[phases.length - 1];
    game.stop();
    assert.equal(rank.phase, 'FINALE_RANK');
    assert.ok(rank.endsAt - Date.now() > 29000 && rank.endsAt - Date.now() <= 30000);
  } finally {
    restore();
  }
});

/** A finale game advanced to FINALE_RANK with ok moderation; collects ballots. */
async function rankingFinale(world = 'AA', moderation = okModeration()) {
  const restore = stubModerate(moderation);
  try {
    const game = finaleGame(world);
    const ballots = {};
    game.on('finale:ballot', (b) => { ballots[b.node] = b.policies; });
    quiet(() => game.startFinaleWritePhase());
    NODE_IDS.forEach((n, i) => game.submitPolicy(n, `Write-in ${i + 1}`));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    quiet(() => game.advancePhase()); // FINALE_DEBATE -> FINALE_RANK
    return { game, ballots };
  } finally {
    restore();
  }
}

test('each player gets a ballot of exactly the 4 policies they did not write', async () => {
  const { game } = await rankingFinale();
  game.stop();
  assert.equal(game.phase, 'FINALE_RANK');
  for (const node of NODE_IDS) {
    const ballot = game.finale.ballots[node];
    assert.equal(ballot.length, 4);
    assert.ok(!ballot.includes(Object.keys(game.finale.authors).find((id) => game.finale.authors[id] === node)), `${node} never ranks its own`);
  }
});

test('finale:ballot is emitted privately per node with { policies: [{ id, text }] } of length 4', async () => {
  const { game, ballots } = await rankingFinale();
  game.stop();
  assert.deepEqual(Object.keys(ballots).sort(), [...NODE_IDS]);
  for (const node of NODE_IDS) {
    assert.equal(ballots[node].length, 4);
    for (const p of ballots[node]) assert.deepEqual(Object.keys(p).sort(), ['id', 'text']);
    assert.deepEqual(ballots[node].map((p) => p.id), game.finale.ballots[node]);
  }
});

test('rankPolicies records a ranking during FINALE_RANK only', async () => {
  const { game } = await rankingFinale();
  game.stop();
  const order = game.finale.ballots['NODE-01'];
  assert.equal(game.rankPolicies('NODE-01', order).ok, true);
  assert.deepEqual(game.finale.ranks['NODE-01'], order);
  assert.deepEqual(game.rankedNodes(), ['NODE-01']);
  game.phase = 'FINALE_ENACT';
  assert.equal(game.rankPolicies('NODE-02', game.finale.ballots['NODE-02']).reason, 'RANKING_CLOSED');
});

test('finale:rank must list exactly the 4 ballot policies, once each, never the voter\'s own', async () => {
  const { game } = await rankingFinale();
  game.stop();
  const own = Object.keys(game.finale.authors).find((id) => game.finale.authors[id] === 'NODE-02');
  const ballot = game.finale.ballots['NODE-02'];
  assert.equal(game.rankPolicies('NODE-02', ballot.slice(0, 3)).reason, 'BAD_ORDER');
  assert.equal(game.rankPolicies('NODE-02', [ballot[0], ballot[0], ballot[1], ballot[2]]).reason, 'DUPLICATE_POLICY');
  assert.equal(game.rankPolicies('NODE-02', [own, ballot[0], ballot[1], ballot[2]]).reason, 'OWN_POLICY');
  assert.equal(game.rankPolicies('NODE-02', ['POLICY-9', ballot[0], ballot[1], ballot[2]]).reason, 'UNKNOWN_POLICY');
  assert.equal(game.rankPolicies('NODE-02', 'POLICY-1').reason, 'BAD_ORDER');
  assert.equal(game.finale.ranks['NODE-02'], undefined);
  assert.equal(game.rankPolicies('NODE-02', ballot.slice().reverse()).ok, true);
});

test('players who do not rank before FINALE_RANK expires get a deterministic default ranking', async () => {
  const run = async () => {
    const { game } = await rankingFinale();
    game.rankPolicies('NODE-01', game.finale.ballots['NODE-01'].slice().reverse());
    quiet(() => game.advancePhase()); // the 30 s timer expiring
    game.stop();
    return game;
  };
  const a = await run();
  const b = await run();
  assert.deepEqual(a.finale.rankDefaulted.sort(), ['NODE-02', 'NODE-03', 'NODE-04', 'NODE-05']);
  for (const node of NODE_IDS) {
    assert.equal(a.finale.ranks[node].length, 4);
    assert.deepEqual(a.finale.ranks[node].slice().sort(), a.finale.ballots[node].slice().sort(), 'a permutation of the ballot');
  }
  assert.deepEqual(a.finale.ranks, b.finale.ranks, 'same game, same defaults');
  assert.deepEqual(a.finale.ranks['NODE-01'], a.finale.ballots['NODE-01'].slice().reverse(), 'real rankings kept');
});

test('bordaCount awards 4/3/2/1 points by rank and counts places', () => {
  const tally = engine.bordaCount({
    'NODE-01': ['P2', 'P3', 'P4', 'P5'],
    'NODE-02': ['P1', 'P3', 'P4', 'P5']
  }, ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.deepEqual(tally.P1, { points: 4, places: [1, 0, 0, 0] });
  assert.deepEqual(tally.P3, { points: 6, places: [0, 2, 0, 0] });
  assert.deepEqual(tally.P5, { points: 2, places: [0, 0, 0, 2] });
});
