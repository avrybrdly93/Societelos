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
