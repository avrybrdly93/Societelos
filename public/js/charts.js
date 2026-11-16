// Societelos — resolution charts on an HTML5 <canvas>.
// Draws the Loom's Monte Carlo forecast fan (500 runs) and the realized GDW
// line for one 12-month cycle. Pure drawing: no sockets, no game state.
(function () {
  'use strict';

  const COLORS = {
    band: 'rgba(63, 216, 230, 0.18)',
    median: '#3fd8e6',
    realized: '#f0a430',
    text: '#7d8a9a',
    grid: 'rgba(125, 138, 154, 0.18)',
    axis: '#33404f',
    danger: '#e5484d'
  };
  const PAD = { left: 64, right: 24, top: 20, bottom: 56 };

  /**
   * High-DPI setup: size the backing store to the canvas's on-screen pixels
   * (CSS size x devicePixelRatio x the projector stage scale applied by
   * host.js) and scale the context so drawing code works in CSS pixels.
   * Returns { ctx, w, h } in CSS pixels.
   */
  function fitCanvas(canvas) {
    const cssW = canvas.offsetWidth || canvas.width;
    const cssH = canvas.offsetHeight || canvas.height;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const stageScale = rect && cssW ? rect.width / cssW : 1;
    const ratio = Math.max(1, (window.devicePixelRatio || 1) * (stageScale || 1));
    const pxW = Math.round(cssW * ratio);
    const pxH = Math.round(cssH * ratio);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.cssWidth = cssW;
    canvas.cssHeight = cssH;
    return { ctx, w: cssW, h: cssH };
  }

  /** Plot geometry for a canvas: GDW 0-100 on y, months 0-12 on x. */
  function geometry(canvas, months = 12) {
    const w = canvas.cssWidth || canvas.width;
    const h = canvas.cssHeight || canvas.height;
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    return {
      w, h, months,
      x: (m) => PAD.left + (m / months) * plotW,
      y: (gdw) => PAD.top + (1 - Math.max(0, Math.min(100, gdw)) / 100) * plotH
    };
  }

  function clear(ctx, g) {
    ctx.clearRect(0, 0, g.w, g.h);
  }

  /** Polyline through `values` (one per month starting at month 0). */
  function line(ctx, g, values, { color, width = 3, dash = [] } = {}) {
    if (!values || !values.length) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath();
    values.forEach((v, m) => (m === 0 ? ctx.moveTo(g.x(m), g.y(v)) : ctx.lineTo(g.x(m), g.y(v))));
    ctx.stroke();
    ctx.restore();
  }

  /** Shaded band between two monthly series (lower, upper). */
  function band(ctx, g, lower, upper, color) {
    if (!lower || !upper || !lower.length) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    upper.forEach((v, m) => (m === 0 ? ctx.moveTo(g.x(m), g.y(v)) : ctx.lineTo(g.x(m), g.y(v))));
    for (let m = lower.length - 1; m >= 0; m--) ctx.lineTo(g.x(m), g.y(lower[m]));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Axes and gridlines: GDW 0-100% every 20 on y, months 1-12 on x, plus a
   * crimson Collapse danger zone at the bottom (GDW <= 5, shutdown at 0) and
   * a dashed unrest line at 15%.
   */
  function drawAxes(ctx, g) {
    ctx.save();
    // Collapse danger zone.
    ctx.fillStyle = 'rgba(229, 72, 77, 0.16)';
    ctx.fillRect(g.x(0), g.y(5), g.x(g.months) - g.x(0), g.y(0) - g.y(5));
    ctx.fillStyle = COLORS.danger;
    ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('COLLAPSE', g.x(g.months) - 6, g.y(0) - 3);
    // Horizontal gridlines and GDW labels.
    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= 100; v += 20) {
      ctx.strokeStyle = v === 0 ? COLORS.axis : COLORS.grid;
      ctx.lineWidth = v === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(g.x(0), g.y(v));
      ctx.lineTo(g.x(g.months), g.y(v));
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${v}%`, g.x(0) - 10, g.y(v));
    }
    // Unrest threshold.
    ctx.strokeStyle = 'rgba(229, 72, 77, 0.6)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(g.x(0), g.y(15));
    ctx.lineTo(g.x(g.months), g.y(15));
    ctx.stroke();
    ctx.setLineDash([]);
    // Month ticks 1..12.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.text;
    for (let m = 1; m <= g.months; m++) {
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(g.x(m), g.y(0));
      ctx.lineTo(g.x(m), g.y(0) + 6);
      ctx.stroke();
      ctx.fillText(String(m), g.x(m), g.y(0) + 10);
    }
    ctx.fillText('MONTH', g.x(g.months / 2), g.y(0) + 28);
    ctx.restore();
  }

  /**
   * Draw a whole resolution: forecast fan (p5-p95 band + median) and the
   * realized GDW line. `payload` is the server's resolution payload.
   */
  function render(canvas, payload) {
    if (!canvas || !canvas.getContext || !payload) return;
    const { ctx } = fitCanvas(canvas);
    const forecast = payload.forecast || {};
    const realized = (payload.realized && payload.realized.gdw) || [];
    const months = Math.max(1, (forecast.median || realized).length - 1);
    const g = geometry(canvas, months);
    clear(ctx, g);
    drawAxes(ctx, g);
    band(ctx, g, forecast.p5, forecast.p95, COLORS.band);
    line(ctx, g, forecast.median, { color: COLORS.median, width: 2 });
    line(ctx, g, realized, { color: COLORS.realized, width: 4 });
  }

  window.SocietelosCharts = { COLORS, PAD, fitCanvas, geometry, drawAxes, line, band, render };
})();
