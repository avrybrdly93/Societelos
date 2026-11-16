// Societelos — resolution charts on an HTML5 <canvas>.
// Draws the Loom's Monte Carlo forecast fan (500 runs) and the realized GDW
// line for one 12-month cycle. Pure drawing: no sockets, no game state.
(function () {
  'use strict';

  const COLORS = {
    band: 'rgba(63, 216, 230, 0.18)',
    bandLegend: 'rgba(63, 216, 230, 0.35)',
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

  // The chart currently on screen: { canvas, ctx, g, forecast }.
  let active = null;

  /** Small legend in the top-right corner of the plot. */
  function drawLegend(ctx, g) {
    const items = [
      { label: '5–95% of 500 runs', swatch: (x, y) => { ctx.fillStyle = COLORS.bandLegend; ctx.fillRect(x, y - 7, 26, 14); } },
      { label: 'Forecast median', swatch: (x, y) => { ctx.strokeStyle = COLORS.median; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.stroke(); ctx.setLineDash([]); } },
      { label: 'Realized', swatch: (x, y) => { ctx.strokeStyle = COLORS.realized; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.stroke(); } }
    ];
    ctx.save();
    ctx.font = '15px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let y = PAD.top + 14;
    const x = g.x(g.months) - 230;
    for (const item of items) {
      item.swatch(x, y);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(item.label, x + 36, y);
      y += 24;
    }
    ctx.restore();
  }

  /**
   * Draw the Loom's forecast fan: axes, the shaded 5th-95th percentile band
   * and the dashed median GDW line. `canvas` defaults to the active chart.
   */
  function drawForecastFan(forecast, canvas = active && active.canvas) {
    if (!canvas || !canvas.getContext) return null;
    const { ctx } = fitCanvas(canvas);
    const f = forecast || {};
    const months = Math.max(1, ((f.median && f.median.length) || 13) - 1);
    const g = geometry(canvas, months);
    clear(ctx, g);
    drawAxes(ctx, g);
    band(ctx, g, f.p5, f.p95, COLORS.band);
    line(ctx, g, f.median, { color: COLORS.median, width: 3, dash: [10, 8] });
    drawLegend(ctx, g);
    active = { canvas, ctx, g, forecast: f };
    return active;
  }

  // Running realized-line animation (one at a time).
  let animation = null;

  /** Stop the running realized-line animation, if any. */
  function cancelAnimation() {
    if (animation) {
      cancelAnimationFrame(animation.frame);
      animation = null;
    }
  }

  /**
   * Draw the realized GDW trajectory month by month (months 1-12) over
   * `durationMs` (12 s) on top of the active forecast fan. `onMonthTick(m, gdw)`
   * fires as the line reaches each month m = 1..12. Returns { cancel }.
   */
  function animateRealizedLine(realized, onMonthTick, { durationMs = 12000, canvas, onCollapse } = {}) {
    cancelAnimation();
    const values = Array.from((realized && (realized.gdw || realized)) || []);
    // Collapse: if GDW reaches 0 mid-cycle the line halts there (month c).
    const collapseAt = values.findIndex((v, m) => m > 0 && v <= 0);
    if (canvas || !active) drawForecastFan(active ? active.forecast : null, canvas || (active && active.canvas));
    if (!active || values.length < 2) return { cancel: cancelAnimation };
    const chart = active;
    const months = values.length - 1;
    const msPerMonth = durationMs / months;
    const endMonth = collapseAt > 0 ? collapseAt : months;
    let lastMonth = 0;
    const start = performance.now();
    const state = { frame: null };
    animation = state;

    function drawUpTo(t) {
      // t in months (fractional): redraw the fan, then the line up to t.
      // Redraw the fan each frame; use its fresh geometry in case the
      // canvas was resized mid-animation (layout changes, window resize).
      const current = drawForecastFan(chart.forecast, chart.canvas) || chart;
      const whole = Math.floor(t);
      const partial = values.slice(0, whole + 1);
      if (whole < months) {
        const frac = t - whole;
        partial.push(values[whole] + (values[whole + 1] - values[whole]) * frac);
      }
      const g = current.g;
      const ctx = current.ctx;
      ctx.save();
      ctx.strokeStyle = COLORS.realized;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      partial.forEach((v, i) => {
        const m = Math.min(i, t);
        return i === 0 ? ctx.moveTo(g.x(0), g.y(v)) : ctx.lineTo(g.x(m), g.y(v));
      });
      ctx.stroke();
      // Leading dot.
      const tipM = Math.min(t, months);
      const tipV = partial[partial.length - 1];
      ctx.fillStyle = COLORS.realized;
      ctx.beginPath();
      ctx.arc(g.x(tipM), g.y(tipV), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawCollapse() {
      const current = active || chart;
      const { ctx, g } = current;
      ctx.save();
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = 3;
      const x = g.x(endMonth);
      const y = g.y(0);
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 12); ctx.lineTo(x + 12, y + 12);
      ctx.moveTo(x + 12, y - 12); ctx.lineTo(x - 12, y + 12);
      ctx.stroke();
      ctx.fillStyle = COLORS.danger;
      ctx.font = '700 22px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = endMonth > months / 2 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`LOOM SHUTDOWN // MONTH ${endMonth}`, x + (endMonth > months / 2 ? -18 : 18), y - 16);
      ctx.restore();
    }

    function frame(now) {
      if (animation !== state) return;
      const t = Math.min(endMonth, (now - start) / msPerMonth);
      drawUpTo(t);
      while (lastMonth < Math.floor(t)) {
        lastMonth += 1;
        if (typeof onMonthTick === 'function') onMonthTick(lastMonth, values[lastMonth]);
      }
      if (t < endMonth) {
        state.frame = requestAnimationFrame(frame);
        return;
      }
      animation = null;
      if (collapseAt > 0) {
        drawCollapse();
        if (typeof onCollapse === 'function') onCollapse(endMonth);
      }
    }
    state.frame = requestAnimationFrame(frame);
    return { cancel: () => { if (animation === state) cancelAnimation(); } };
  }

  /**
   * Draw a whole resolution at once: forecast fan plus the full realized
   * line. `payload` is the server's resolution payload.
   */
  function render(canvas, payload) {
    if (!canvas || !canvas.getContext || !payload) return;
    const chart = drawForecastFan(payload.forecast, canvas);
    const realized = (payload.realized && payload.realized.gdw) || [];
    if (chart) line(chart.ctx, chart.g, realized, { color: COLORS.realized, width: 4 });
  }

  window.SocietelosCharts = { COLORS, PAD, fitCanvas, geometry, drawAxes, line, band, drawForecastFan, animateRealizedLine, cancelAnimation, render };
})();
