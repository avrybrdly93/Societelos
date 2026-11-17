'use strict';

// Headless whole-game playthroughs (Wednesday post-merge integration): the
// real engine, simulation, content and Loom module, all 5 cycles to END on
// shrunk phase timers. No network: GEMINI_API_KEY is unset unless a test
// injects its own Loom config and fetch.

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../gameEngine');
const loom = require('../loom');
const { GameState, NODE_IDS } = engine;

/**
 * Play one full game. `world` sets the Cycle 1/2 votes (e.g. 'BA'); cycles
 * 3-5 vote `lateVote(cycle, i)`. Phones write `writeIn(i)` in FINALE_WRITE,
 * rank their ballot in order, and `onEvent` sees every engine event.
 */
function playGame({ gameId, world, lateVote = (cycle, i) => (i < 3 ? 'A' : 'B'), writeIn = (i) => `Council proposal number ${i + 1}`, onEvent = () => {}, phaseSeconds = {}, guardMs = 20000 }) {
  const saved = { fast: process.env.FAST_TIMERS, secs: process.env.FAST_TIMER_SECONDS, key: process.env.GEMINI_API_KEY };
  process.env.FAST_TIMERS = 'true';
  process.env.FAST_TIMER_SECONDS = '0.01';
  delete process.env.GEMINI_API_KEY;
  const game = new GameState({ roomCode: 'PLAY', phaseSeconds });
  const restoreEnv = () => {
    for (const [k, v] of [['FAST_TIMERS', saved.fast], ['FAST_TIMER_SECONDS', saved.secs], ['GEMINI_API_KEY', saved.key]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  game.gameId = gameId;
  const out = { game, phases: [], payloads: [], resolutions: [], reveals: [], intel: [], ballots: [], feedback: [], roles: {}, end: null, restoreEnv };
  const log = console.log;
  console.log = () => {};
  NODE_IDS.forEach((node, i) => { game.addPlayer(`s${i}`, `P${i}`); game.setReady(node, true); });
  game.on('role:assigned', ({ node, role }) => { out.roles[node] = role.key; });
  game.on('resolution', (r) => out.resolutions.push(r));
  game.on('world:reveal', (w) => out.reveals.push(w));
  game.on('intel:drop', (e) => out.intel.push({ cycle: game.cycle, ...e }));
  game.on('finale:feedback', (f) => { out.feedback.push(f); onEvent('finale:feedback', f, game); });
  game.on('finale:ballot', (b) => {
    out.ballots.push(b);
    setImmediate(() => game.rankPolicies(b.node, b.policies.map((p) => p.id)));
  });
  return new Promise((resolve, reject) => {
    const finish = (fn) => { game.stop(); console.log = log; restoreEnv(); fn(); };
    const guard = setTimeout(() => finish(() => reject(new Error(`stalled: ${out.phases.slice(-4).join(' ')}`))), guardMs);
    game.on('phase', (p) => {
      out.phases.push(`${p.cycle}:${p.phase}`);
      out.payloads.push(p);
      onEvent('phase', p, game);
      if (p.phase === 'VOTE') NODE_IDS.forEach((n, i) => game.castVote(n, p.cycle <= 2 ? world[p.cycle - 1] : lateVote(p.cycle, i)));
      if (p.phase === 'FINALE_WRITE') NODE_IDS.forEach((n, i) => game.submitPolicy(n, writeIn(i)));
      if (p.phase === 'END') {
        clearTimeout(guard);
        out.end = p;
        setImmediate(() => finish(() => resolve(out)));
      }
    });
    game.startIntroPhase();
  });
}

/** A loom.moderate stand-in: every write-in comes back "ok" with distinct tags. */
const TAGS = [['artisan'], ['lotus'], ['ghost'], ['assimilator'], []];
function okModeration(subs) {
  return subs.map((s, i) => ({
    node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: TAGS[i % TAGS.length],
    effects: { purpose: 0.1, connection: 0.05 * i, health: 0.1, trust: 0, fairness: 0, autonomy: -0.05 }
  }));
}

/** Swap loom functions for one test, always restoring them. */
async function withLoom(overrides, fn) {
  const original = {};
  for (const k of Object.keys(overrides)) { original[k] = loom[k]; loom[k] = overrides[k]; }
  try {
    return await fn();
  } finally {
    Object.assign(loom, original);
  }
}

const FINALE_FLOW = ['5:INCIDENT', '5:FINALE_WRITE', '5:FINALE_MOD', '5:FINALE_DEBATE', '5:FINALE_RANK', '5:FINALE_ENACT', '5:END'];
const FALLBACK_FLOW = ['5:INCIDENT', '5:FINALE_WRITE', '5:FINALE_MOD', '5:DEBATE', '5:VOTE', '5:RESOLUTION', '5:END'];
const WORLD_CRISES = {
  AA: ['aa-purpose-drift', 'aa-lost-knowledge', 'aa-fake-struggle'],
  AB: ['ab-the-pods', 'ab-mood-dial', 'ab-merge-offer'],
  BA: ['ba-shadow-elite', 'ba-status-wars', 'ba-vote-to-seize'],
  BB: ['bb-scroll-extinction', 'bb-the-unplugged', 'bb-march-datacenter']
};

function incidentsByCycle(out) {
  return Object.fromEntries(out.payloads.filter((p) => p.phase === 'INCIDENT').map((p) => [p.cycle, p.crisis && p.crisis.id]));
}

// TASK-574 ------------------------------------------------------------------

test('post-merge: Cycle 5 write-and-rank flows FINALE_WRITE -> FINALE_MOD -> FINALE_DEBATE -> FINALE_RANK -> FINALE_ENACT in every world', async () => {
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    for (const world of Object.keys(WORLD_CRISES)) {
      const out = await playGame({ gameId: `finaleflow-${world}`, world });
      assert.deepEqual(out.phases.filter((p) => p.startsWith('5:')), FINALE_FLOW, `${world} finale phases`);
      assert.equal(incidentsByCycle(out)[5], WORLD_CRISES[world][2], `${world} finale crisis`);

      // FINALE_DEBATE shows 5 anonymous policies: ids and text only.
      const debate = out.payloads.find((p) => p.phase === 'FINALE_DEBATE');
      const policies = debate.policies || (debate.finale && debate.finale.policies);
      assert.equal(policies.length, 5, `${world} debate policies`);
      for (const p of policies) {
        assert.deepEqual(Object.keys(p).sort(), ['id', 'text'], 'no authors, tags or effects on the projector');
        assert.match(p.id, /^POLICY-[1-5]$/);
      }

      // Each phone ranks exactly the 4 policies it did not write.
      assert.equal(out.ballots.length, 5);
      for (const b of out.ballots) {
        assert.equal(b.policies.length, 4);
        assert.ok(!b.policies.some((p) => out.game.finaleAuthor(p.id) === b.node), `${b.node} never ranks its own policy`);
      }

      // FINALE_ENACT enacts the Borda top three at 50/25/25 and simulates them.
      const finale = out.resolutions[4].result;
      assert.equal(finale.finale, true);
      assert.deepEqual(finale.enacted.map((e) => e.weight), [0.5, 0.25, 0.25]);
      assert.deepEqual(finale.enacted.map((e) => e.place), ['first', 'second', 'third']);
      assert.equal(out.game.gdwHistory.length, 1 + 5 * 12, `${world} has 60 months of realized GDW`);
    }
  });
});

// TASK-575 ------------------------------------------------------------------

test('post-merge: Worlds BA and BB play their own crises, intel and finale across Cycles 3-5', async () => {
  const { crises } = engine.loadGameData();
  const byId = Object.fromEntries(crises.crises.map((c) => [c.id, c]));
  await withLoom({ moderate: async (subs) => okModeration(subs) }, async () => {
    for (const world of ['BA', 'BB']) {
      const out = await playGame({ gameId: `latecycles-${world}`, world });
      assert.equal(out.game.worldKey, world);
      assert.equal(out.reveals.length, 1, 'one world reveal after Cycle 2');
      assert.equal(out.reveals[0].worldKey, world);

      const incidents = incidentsByCycle(out);
      assert.deepEqual([incidents[3], incidents[4], incidents[5]], WORLD_CRISES[world], `${world} cycles 3-5`);

      // Cycles 3 and 4: every node gets the intel authored for its secret role.
      for (const cycle of [3, 4]) {
        const crisis = byId[WORLD_CRISES[world][cycle - 3]];
        const drops = out.intel.filter((d) => d.cycle === cycle);
        assert.equal(drops.length, 5, `${world} cycle ${cycle} intel drops`);
        for (const d of drops) assert.equal(d.text, crisis.intel[out.roles[d.node]], `${world} c${cycle} ${d.node} gets ${out.roles[d.node]} intel`);
      }

      // Cycles 3 and 4 resolve as normal binary votes, Cycle 5 as the finale.
      assert.equal(out.resolutions.length, 5);
      assert.ok(['A', 'B'].includes(out.resolutions[2].result.winner));
      assert.ok(['A', 'B'].includes(out.resolutions[3].result.winner));
      assert.equal(out.resolutions[4].result.finale, true);
      assert.deepEqual(out.phases.filter((p) => p.startsWith('5:')), FINALE_FLOW);
    }
  });
});

// TASK-576 / TASK-577 -------------------------------------------------------

/** The exact phase sequence of an offline game that survives to Cycle 5. */
function expectedOfflinePhases() {
  const cycle = (c) => ['INCIDENT', 'INTEL', 'DEBATE', 'VOTE', 'RESOLUTION'].map((p) => `${c}:${p}`);
  return [
    '0:INTRO', '0:ROLE_ASSIGN', '0:CHAMBER',
    ...cycle(1), ...cycle(2), '2:WORLD_REVEAL', ...cycle(3), ...cycle(4),
    ...FALLBACK_FLOW
  ];
}

/** Shared checks for an offline (no GEMINI_API_KEY) 5-cycle headless game. */
async function headlessOfflineRun(world) {
  const out = await playGame({ gameId: `headless-${world}`, world });
  const phases = out.phases.filter((p, i, a) => p !== a[i - 1]); // a resubmit/extension re-broadcast is one phase
  const expected = expectedOfflinePhases();
  // Cycle 0 lead-in phases may be numbered 0 or 1 depending on when the
  // engine bumps the counter; compare from the first INCIDENT on.
  assert.deepEqual(phases.slice(phases.indexOf('1:INCIDENT')), expected.slice(expected.indexOf('1:INCIDENT')), `${world} phase order`);
  assert.equal(out.game.worldKey, world);
  assert.deepEqual(Object.values(incidentsByCycle(out)).slice(2), WORLD_CRISES[world]);
  assert.equal(out.resolutions.length, 5);
  for (const r of out.resolutions) {
    assert.ok(Number.isFinite(r.gdw), 'every resolution reports a GDW');
    assert.ok(r.loomLine && r.loomLine.length > 0, 'offline Loom narration on every cycle');
  }
  assert.equal(out.game.gdwHistory.length, 1 + 5 * 12, '60 monthly points plus the start');
  assert.ok(out.game.gdw > 0, `${world} survived to the end`);
  for (const node of NODE_IDS) assert.ok(Number.isInteger(out.game.scores[node]), `${node} has an integer score`);
  // Same game id, same choices: the exact same realized GDW line.
  const again = await playGame({ gameId: `headless-${world}`, world });
  assert.deepEqual(again.game.gdwHistory, out.game.gdwHistory, `${world} replays deterministically`);
  return out;
}

test('headless 5-cycle playthrough on the BA (Uneasy Republic) branch reaches END offline', async () => {
  const out = await headlessOfflineRun('BA');
  assert.equal(out.game.volatility, 1.5, 'The Assembly (2A) keeps the rest of the game volatile');
});

test('headless 5-cycle playthrough on the BB (Gilded Cage) branch reaches END offline', async () => {
  const out = await headlessOfflineRun('BB');
  assert.equal(out.game.volatility, 1, 'Delegated Control (2B) keeps normal volatility');
  assert.ok(out.resolutions[0].gdw > 25, 'the easy 1B opening lifts GDW');
});
