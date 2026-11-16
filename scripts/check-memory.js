'use strict';

// Memory check: run 4 consecutive cycles many times over, then batches of 50
// consecutive simulate() calls, and confirm the heap stays flat (no leak of
// sim states, topology caches or listeners).
// Run with: node --expose-gc scripts/check-memory.js   (npm run check:mem)

const engine = require('../server/gameEngine');

const ROUNDS = 6; // 6 rounds x 4 cycles per measurement
const LIMIT_MB = 8; // allowed heap growth between the warm-up and the final measurement

async function playFourCycles(game) {
  for (let cycle = 1; cycle <= 4; cycle++) {
    game.startCycle(cycle);
    game.crisis = engine.selectCrisis(game.data.crises, cycle, game.worldKey, game.data.roles);
    game.phase = engine.PHASES.VOTE;
    game.votingOpen = true;
    engine.NODE_IDS.forEach((node, i) => game.castVote(node, (cycle + i) % 2 ? 'A' : 'B'));
    await game.startResolutionPhase();
    game.clearPhaseTimer();
  }
}

function heapMb() {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed / 1048576;
}

async function main() {
  if (typeof global.gc !== 'function') {
    console.error('run with node --expose-gc');
    process.exit(2);
  }
  const log = console.log;
  console.log = () => {};
  const game = new engine.GameState({ roomCode: 'MEM' });
  engine.NODE_IDS.forEach((node, i) => game.addPlayer(`s${i}`, `P${i}`));
  game.assignRoles(game.data.roles);
  const samples = [];
  for (let m = 0; m < 4; m++) {
    for (let r = 0; r < ROUNDS; r++) await playFourCycles(game);
    samples.push(heapMb());
  }
  console.log = log;
  const growth = samples[samples.length - 1] - samples[1];
  console.log(`heap after each ${ROUNDS * 4} cycles (MB): ${samples.map((v) => v.toFixed(1)).join(', ')}`);
  if (growth > LIMIT_MB) {
    console.error(`FAIL: heap grew ${growth.toFixed(1)} MB (limit ${LIMIT_MB} MB)`);
    process.exit(1);
  }
  console.log(`PASS: heap flat across consecutive cycles (growth ${growth.toFixed(1)} MB)`);

  // 50 consecutive simulate() calls (500 forecasts + 1 realized each), each
  // chained from the previous final state as a real game does.
  const sim = require('../server/sim');
  let simState = sim.createInitialState(require('../data/sim.json'));
  const effects = { purpose: 0.2, connection: -0.1, health: 0.1, trust: -0.2, fairness: 0.3, autonomy: 0 };
  const simSamples = [];
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 50; i++) simState = sim.simulate(simState, effects, { runs: 500, seed: batch * 100 + i }).finalState;
    simSamples.push(heapMb());
  }
  const simGrowth = simSamples[simSamples.length - 1] - simSamples[1];
  console.log(`heap after each 50 simulate() calls (MB): ${simSamples.map((v) => v.toFixed(1)).join(', ')}`);
  if (simGrowth > LIMIT_MB) {
    console.error(`FAIL: simulate() heap grew ${simGrowth.toFixed(1)} MB over 150 calls (limit ${LIMIT_MB} MB)`);
    process.exit(1);
  }
  console.log(`PASS: no leak across consecutive simulate() calls (growth ${simGrowth.toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
