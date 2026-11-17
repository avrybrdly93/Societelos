'use strict';

// public/js/map.js in a VM with a minimal fake DOM: checks month-by-month
// recolouring of all five SVG districts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'map.js'), 'utf8');

function loadMap() {
  const fills = {}; // district id -> latest --district-fill
  const element = (id) => ({
    id,
    style: { setProperty: (k, v) => { if (k === '--district-fill') fills[id.replace('district-', '')] = v; }, removeProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {} },
    querySelector: () => null,
    getAttribute: () => '0',
    setAttribute() {},
    append() {},
    remove() {},
    getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    getBoundingClientRect: () => ({}),
    appendChild() {},
    parentNode: { appendChild() {} }
  });
  const nodes = {};
  const document = {
    getElementById: (id) => (nodes[id] = nodes[id] || element(id)),
    querySelectorAll: () => [],
    createElementNS: () => element('x')
  };
  const window = {};
  vm.runInContext(SOURCE, vm.createContext({ window, document, setTimeout, Math, Number, Object, Array, String }));
  return { map: window.SocietelosMap, fills };
}

const IDS = ['D1', 'D2', 'D3', 'D4', 'D5'];

test('wellbeingToColor spans critical red -> amber -> thriving sage', () => {
  const { map } = loadMap();
  assert.equal(map.wellbeingToColor(0.1), 'rgb(229, 72, 77)');
  assert.equal(map.wellbeingToColor(0.4), 'rgb(240, 164, 48)');
  assert.equal(map.wellbeingToColor(0.9), 'rgb(181, 204, 120)');
  assert.notEqual(map.wellbeingToColor(0.3), map.wellbeingToColor(0.35), 'interpolates between stops');
});

test('playback recolours all 5 districts for every month of mock data', () => {
  const { map, fills } = loadMap();
  // Mock 13 months: each district drifts differently (D1 falls, D5 rises).
  const months = Array.from({ length: 13 }, (_, m) => ({
    D1: 0.40 - m * 0.015,
    D2: 0.40,
    D3: 0.40 + m * 0.005,
    D4: 0.35 + m * 0.01,
    D5: 0.40 + m * 0.02
  }));
  map.startPlayback(months, 1000, []);
  for (const id of IDS) assert.equal(fills[id], map.wellbeingToColor(months[0][id]), `${id} month 0`);
  for (let m = 1; m <= 12; m++) {
    map.showMonth(m);
    for (const id of IDS) assert.equal(fills[id], map.wellbeingToColor(months[m][id]), `${id} month ${m}`);
  }
  // D1 ended in the red band, D5 in the teal band, D2 unchanged amber.
  assert.equal(fills.D2, 'rgb(240, 164, 48)');
  assert.notEqual(fills.D1, fills.D5);
  // After stopPlayback, further ticks change nothing.
  map.stopPlayback();
  const before = { ...fills };
  map.showMonth(3);
  assert.deepEqual(fills, before);
});

test('integration: map.js plays a real 12-month districts trajectory (with shocks) from the engine', async () => {
  const engine = require('../gameEngine');
  const game = new engine.GameState({ roomCode: 'MAPR', phaseSeconds: { RESOLUTION: 60 } });
  game.gameId = 'mapreal00001';
  const log = console.log;
  console.log = () => {};
  let payload;
  try {
    engine.NODE_IDS.forEach((n, i) => game.addPlayer(`s${i}`, `P${i}`));
    game.startCycle(1);
    game.crisis = engine.selectCrisis(game.data.crises, 1, null, game.data.roles);
    game.phase = engine.PHASES.VOTE;
    game.votingOpen = true;
    engine.NODE_IDS.forEach((n) => game.castVote(n, 'A'));
    payload = JSON.parse(JSON.stringify(await game.startResolutionPhase()));
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
  assert.equal(payload.districts.length, 13);
  const { map, fills } = loadMap();
  map.startPlayback(payload.districts, 1000, payload.realized.shocks);
  for (let m = 0; m <= 12; m++) {
    map.showMonth(m);
    for (const id of IDS) assert.equal(fills[id], map.wellbeingToColor(payload.districts[m][id]), `${id} month ${m}`);
  }
});
