// Societelos — resolution charts on an HTML5 <canvas>.
// Draws the Loom's Monte Carlo forecast fan (500 runs) and the realized GDW
// line for one 12-month cycle. Pure drawing: no sockets, no game state.
(function () {
  'use strict';

  const COLORS = {
    band: 'rgba(63, 216, 230, 0.18)',
    median: '#3fd8e6',
    realized: '#f0a430',
    text: '#7d8a9a'
  };
  const PAD = { left: 64, right: 24, top: 24, bottom: 48 };

  /** Plot geometry for a canvas: GDW 0-100 on y, months 0-12 on x. */
  function geometry(canvas, months = 12) {
    const w = canvas.width;
    const h = canvas.height;
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
   * Draw a whole resolution: forecast fan (p5-p95 band + median) and the
   * realized GDW line. `payload` is the server's resolution payload.
   */
  function render(canvas, payload) {
    if (!canvas || !canvas.getContext || !payload) return;
    const ctx = canvas.getContext('2d');
    const forecast = payload.forecast || {};
    const realized = (payload.realized && payload.realized.gdw) || [];
    const months = Math.max(1, (forecast.median || realized).length - 1);
    const g = geometry(canvas, months);
    clear(ctx, g);
    band(ctx, g, forecast.p5, forecast.p95, COLORS.band);
    line(ctx, g, forecast.median, { color: COLORS.median, width: 2 });
    line(ctx, g, realized, { color: COLORS.realized, width: 4 });
  }

  window.SocietelosCharts = { COLORS, PAD, geometry, line, band, render };
})();
