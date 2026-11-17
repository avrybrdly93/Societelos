'use strict';

// public/js/charts.js runs in the browser; these tests load it into a VM with
// a recording 2D-context mock so drawing maths can be checked headlessly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'charts.js'), 'utf8');

/** A fake canvas whose context records every path point and fill. */
function mockCanvas(width = 660, height = 360) {
  const points = [];
  const ctx = new Proxy({ points }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'moveTo' || prop === 'lineTo') return (x, y) => points.push({ x, y });
      if (prop === 'arc') return (x, y) => points.push({ x, y, arc: true });
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  return {
    offsetWidth: width,
    offsetHeight: height,
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width, height }),
    getContext: () => ctx,
    ctx
  };
}

/** Load charts.js with fake browser globals; returns { charts, frames }. */
function loadCharts() {
  const frames = [];
  let now = 0;
  const window = { devicePixelRatio: 2 };
  const context = vm.createContext({
    window,
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    Math, Array, Number, String, Object
  });
  vm.runInContext(SOURCE, context);
  return {
    charts: window.SocietelosCharts,
    // Run queued animation frames as if `ms` had passed.
    advance(ms) {
      now += ms;
      const queued = frames.splice(0);
      queued.forEach((fn) => fn(now));
    }
  };
}

const months = (fn) => Array.from({ length: 13 }, (_, m) => fn(m));

test('forecast fan renders extreme spreads (p5 at 0%, p95 at 90%) inside the plot', () => {
  const { charts } = loadCharts();
  const canvas = mockCanvas();
  const forecast = {
    median: months((m) => 25 + m),
    p5: months((m) => (m === 0 ? 25 : 0)),
    p95: months((m) => (m === 0 ? 25 : 90)),
    pCollapse: 0.05,
    pUnrest: 0.3
  };
  const chart = charts.drawForecastFan(forecast, canvas);
  assert.ok(chart, 'chart drawn');
  // High-DPI backing store: CSS size x devicePixelRatio (2).
  assert.equal(canvas.width, 1320);
  assert.equal(canvas.height, 720);
  const { g } = chart;
  const top = charts.PAD.top;
  const bottom = 360 - charts.PAD.bottom;
  assert.equal(g.y(0), bottom);
  assert.ok(Math.abs(g.y(90) - (top + (bottom - top) * 0.1)) < 1e-9);
  for (const p of canvas.ctx.points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'finite coordinates');
    assert.ok(p.y >= top - 1e-9 && p.y <= bottom + 40, `y ${p.y} inside the canvas`);
  }
  // Out-of-range values clamp to the 0-100 axis instead of leaving the plot.
  assert.equal(g.y(-20), bottom);
  assert.equal(g.y(140), top);
});

test('realized line halts in Collapse when GDW hits 0 mid-cycle', () => {
  const { charts, advance } = loadCharts();
  const canvas = mockCanvas();
  charts.drawForecastFan({ median: months(() => 20), p5: months(() => 10), p95: months(() => 30) }, canvas);
  // GDW falls to 0 in month 7 and (hypothetically) bounces back afterwards.
  const gdw = [12, 10, 8, 6, 5, 3, 1, 0, 2, 4, 6, 8, 10];
  const ticks = [];
  let collapsedAt = null;
  charts.animateRealizedLine({ gdw }, (m, v) => ticks.push([m, v]), { durationMs: 12000, onCollapse: (m) => { collapsedAt = m; } });
  for (let i = 0; i < 40; i++) advance(500); // 20 s of frames
  assert.deepEqual(ticks.map(([m]) => m), [1, 2, 3, 4, 5, 6, 7], 'no months after the collapse');
  assert.deepEqual(ticks[ticks.length - 1], [7, 0]);
  assert.equal(collapsedAt, 7);
});

test('realized line plays all 12 months when GDW stays above 0', () => {
  const { charts, advance } = loadCharts();
  const canvas = mockCanvas();
  charts.drawForecastFan({ median: months(() => 30), p5: months(() => 20), p95: months(() => 40) }, canvas);
  const ticks = [];
  let collapsed = false;
  charts.animateRealizedLine({ gdw: months((m) => 25 + m) }, (m) => ticks.push(m), { onCollapse: () => { collapsed = true; } });
  for (let i = 0; i < 40; i++) advance(500);
  assert.deepEqual(ticks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(collapsed, false);
});

test('cancelAnimation stops the realized-line rAF loop immediately', () => {
  const { charts, advance } = loadCharts();
  const canvas = mockCanvas();
  charts.drawForecastFan({ median: months(() => 30) }, canvas);
  const ticks = [];
  const handle = charts.animateRealizedLine({ gdw: months((m) => 25 + m) }, (m) => ticks.push(m));
  advance(2500); // months 1-2
  handle.cancel();
  for (let i = 0; i < 30; i++) advance(500);
  assert.ok(ticks.length <= 2, `ticks after cancel: ${ticks}`);
  // A new animation replaces (and cancels) a running one.
  const first = [];
  const second = [];
  charts.animateRealizedLine({ gdw: months(() => 30) }, (m) => first.push(m));
  advance(1500);
  charts.animateRealizedLine({ gdw: months(() => 30) }, (m) => second.push(m));
  for (let i = 0; i < 30; i++) advance(500);
  assert.ok(first.length <= 1, 'replaced animation stopped');
  assert.equal(second.length, 12);
});

/** A real resolution payload from the engine, as it arrives over the socket. */
async function realResolution(gameId = 'chartsreal01') {
  const engine = require('../gameEngine');
  const game = new engine.GameState({ roomCode: 'CHRT', phaseSeconds: { RESOLUTION: 60 } });
  game.gameId = gameId;
  const log = console.log;
  console.log = () => {};
  try {
    engine.NODE_IDS.forEach((n, i) => game.addPlayer(`s${i}`, `P${i}`));
    game.startCycle(1);
    game.crisis = engine.selectCrisis(game.data.crises, 1, null, game.data.roles);
    game.phase = engine.PHASES.VOTE;
    game.votingOpen = true;
    engine.NODE_IDS.forEach((n) => game.castVote(n, 'B'));
    const r = await game.startResolutionPhase();
    return JSON.parse(JSON.stringify(r));
  } finally {
    game.clearPhaseTimer();
    console.log = log;
  }
}

test('integration: charts.js draws real forecast and realized payloads from the engine', async () => {
  const payload = await realResolution();
  const { charts, advance } = loadCharts();
  const canvas = mockCanvas();
  const chart = charts.drawForecastFan(payload.forecast, canvas);
  assert.ok(chart && chart.g.months === 12);
  const ticks = [];
  charts.animateRealizedLine(payload.realized, (m, v) => ticks.push([m, v]));
  for (let i = 0; i < 30; i++) advance(500);
  assert.deepEqual(ticks.map(([m]) => m), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(Math.abs(ticks[11][1] - payload.realized.finalGdw) < 1e-9, 'last tick is the realized final GDW');
  for (const p of canvas.ctx.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('forecastVerdict: month-12 callout beats or misses the forecast median', () => {
  const { charts } = loadCharts();
  assert.equal(charts.forecastVerdict(40, 37).text, 'BEAT FORECAST BY +3.0%');
  assert.equal(charts.forecastVerdict(20, 37).text, 'MISSED FORECAST BY -17.0%');
  assert.equal(charts.forecastVerdict(30, 30).beat, true);
  assert.equal(charts.forecastVerdict(30, undefined), null);
});

// TASK-660 ------------------------------------------------------------------

test('drawFullHistoryChart plots 60 months on a 5-year axis with cycle dividers and grade bands', () => {
  const { charts } = loadCharts();
  const canvas = mockCanvas(1100, 300);
  const history = Array.from({ length: 61 }, (_, m) => 25 + Math.sin(m / 6) * 10);
  const markers = [1, 2, 3, 4, 5].map((c) => ({ cycle: c, index: c * 12 }));
  const chart = charts.drawFullHistoryChart(history, canvas, { cycleMarkers: markers });
  assert.ok(chart);
  assert.equal(chart.months, 60);
  const { g } = chart;
  // The realized line's last point sits at the right edge of the plot, month 60.
  const linePts = canvas.ctx.points.filter((p) => !p.arc);
  const last = history.length - 1;
  assert.ok(linePts.some((p) => Math.abs(p.x - g.x(last)) < 1e-6 && Math.abs(p.y - g.y(history[last])) < 1e-6));
  // A dot on each cycle's closing month.
  const dots = canvas.ctx.points.filter((p) => p.arc);
  assert.deepEqual(dots.map((d) => Math.round(d.x)), markers.map((m) => Math.round(g.x(m.index))));
  // Four dividers at months 12, 24, 36, 48 (vertical moveTo/lineTo pairs).
  for (const m of [12, 24, 36, 48]) {
    assert.ok(linePts.some((p) => Math.abs(p.x - g.x(m)) < 1e-6 && Math.abs(p.y - g.y(100)) < 1e-6), `divider at month ${m}`);
  }
  assert.equal(JSON.stringify(charts.GRADE_BANDS.map((b) => b.from)), '[60,35,1,0]'); // cross-realm array
});

test('drawFullHistoryChart keeps the 5-year axis for a game that shut down early', () => {
  const { charts } = loadCharts();
  for (const len of [13, 25, 37, 49, 61]) {
    const canvas = mockCanvas(1100, 300);
    const history = Array.from({ length: len }, (_, m) => Math.max(0, 25 - m * (25 / (len - 1))));
    const chart = charts.drawFullHistoryChart(history, canvas);
    assert.equal(chart.months, 60, `${len - 1} months still on a 60-month axis`);
    const pts = canvas.ctx.points.filter((p) => !p.arc);
    for (const p of pts) assert.ok(p.x >= charts.PAD.left - 1e-6 && p.x <= 1100 - charts.PAD.right + 1e-6, 'inside the plot');
  }
  assert.equal(charts.drawFullHistoryChart([], mockCanvas()).months, 60, 'empty history still draws the frame');
});
