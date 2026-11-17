// Societelos — resolution charts on an HTML5 <canvas>.
// Draws the Loom's Monte Carlo forecast fan (500 runs) and the realized GDW
// line for one 12-month cycle. Pure drawing: no sockets, no game state.
(function () {
  'use strict';

  const COLORS = {
    band: 'rgba(230, 198, 135, 0.18)',
    bandLegend: 'rgba(230, 198, 135, 0.35)',
    median: '#e6c687',
    realized: '#fff3d6',
    text: '#a89f88',
    grid: 'rgba(125, 138, 154, 0.18)',
    axis: '#3b4a43',
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
    ctx.font = '300 14px Montserrat, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('COLLAPSE', g.x(g.months) - 6, g.y(0) - 3);
    // Horizontal gridlines and GDW labels.
    ctx.font = '300 16px Montserrat, sans-serif';
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
    ctx.font = '300 15px Montserrat, sans-serif';
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

  /**
   * Glowing dot at the realized line's tip: a soft halo that breathes with
   * the animation clock `t` (months), a blurred glow and a bright core.
   */
  function drawEndpointDot(ctx, g, m, v, t = 0) {
    if (typeof v !== 'number') return;
    const x = g.x(m);
    const y = g.y(v);
    const breathe = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    ctx.save();
    ctx.fillStyle = 'rgba(240, 164, 48, 0.22)';
    ctx.beginPath();
    ctx.arc(x, y, 13 + 5 * breathe, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = COLORS.realized;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.realized;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff4dc';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Month-12 verdict beside the realized endpoint: "BEAT FORECAST BY +X%"
   * (teal) or "MISSED FORECAST BY -X%" (crimson), X = realized minus the
   * forecast median at the last month, in GDW points.
   */
  function forecastVerdict(realizedEnd, medianEnd) {
    if (typeof realizedEnd !== 'number' || typeof medianEnd !== 'number') return null;
    const diff = Math.round((realizedEnd - medianEnd) * 10) / 10;
    const beat = diff >= 0;
    return { beat, diff, text: beat ? `BEAT FORECAST BY +${diff.toFixed(1)}%` : `MISSED FORECAST BY ${diff.toFixed(1)}%` };
  }
  function drawForecastCallout(ctx, g, m, realizedEnd, medianEnd) {
    const verdict = forecastVerdict(realizedEnd, medianEnd);
    if (!verdict) return null;
    const x = g.x(m);
    const y = g.y(realizedEnd);
    ctx.save();
    ctx.font = '300 20px Montserrat, sans-serif';
    const measured = ctx.measureText ? ctx.measureText(verdict.text) : null;
    const tw = (measured && measured.width) || verdict.text.length * 12;
    const boxW = tw + 24;
    const boxH = 34;
    // Left of the endpoint; above it unless that would leave the plot.
    const bx = Math.max(PAD.left + 4, x - 18 - boxW);
    const by = y - 22 - boxH < PAD.top ? y + 22 : y - 22 - boxH;
    const color = verdict.beat ? '#b5cc78' : COLORS.danger;
    ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(verdict.text, bx + 12, by + boxH / 2 + 1);
    ctx.restore();
    return verdict;
  }

  /** Crimson X and "LOOM SHUTDOWN · MONTH c" where the realized line hit 0. */
  function drawCollapseMark(chart, endMonth, months) {
    const { ctx, g } = chart;
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
    ctx.font = '300 22px Montserrat, sans-serif';
    ctx.textAlign = endMonth > months / 2 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`LOOM SHUTDOWN · MONTH ${endMonth}`, x + (endMonth > months / 2 ? -18 : 18), y - 16);
    ctx.restore();
  }

  // Running realized-line animation (one at a time).
  let animation = null;
  // The last realized line that finished drawing, so redraw() can repaint
  // it after a resize: { chart, values, months, endMonth, collapsed }.
  let finished = null;

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
    finished = null;
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
      ctx.restore();
      // Glowing endpoint dot on the leading edge of the realized line.
      const tipM = Math.min(t, months);
      drawEndpointDot(ctx, g, tipM, partial[partial.length - 1], t);
    }

    function drawCollapse() {
      drawCollapseMark(active || chart, endMonth, months);
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
      finished = { chart: active || chart, values, months, endMonth, collapsed: collapseAt > 0, drawUpTo };
      if (collapseAt > 0) {
        drawCollapse();
        if (typeof onCollapse === 'function') onCollapse(endMonth);
      } else {
        const current = active || chart;
        const median = current.forecast && current.forecast.median;
        drawForecastCallout(current.ctx, current.g, months, values[months], median && median[months]);
      }
    }
    state.frame = requestAnimationFrame(frame);
    return { cancel: () => { if (animation === state) cancelAnimation(); } };
  }

  /**
   * Repaint the chart on screen at the canvas's current size, e.g. after the
   * projector window is resized or the teacher toggles fullscreen (F11). A
   * running animation needs nothing (every frame refits the canvas); a
   * finished one is redrawn in full, with its callout or shutdown mark.
   */
  function redraw() {
    if (animation || !active) return;
    if (!finished || finished.chart.canvas !== active.canvas) {
      drawForecastFan(active.forecast, active.canvas);
      return;
    }
    const f = finished;
    f.drawUpTo(f.endMonth);
    const current = active;
    if (f.collapsed) drawCollapseMark(current, f.endMonth, f.months);
    else {
      const median = current.forecast && current.forecast.median;
      drawForecastCallout(current.ctx, current.g, f.months, f.values[f.months], median && median[f.months]);
    }
  }

  /**
   * Draw a whole resolution at once: forecast fan plus the full realized
   * line. `payload` is the server's resolution payload.
   */
  function render(canvas, payload) {
    if (!canvas || !canvas.getContext || !payload) return;
    const chart = drawForecastFan(payload.forecast, canvas);
    const realized = (payload.realized && payload.realized.gdw) || [];
    if (!chart) return;
    line(chart.ctx, chart.g, realized, { color: COLORS.realized, width: 4 });
    const last = realized.length - 1;
    const median = payload.forecast && payload.forecast.median;
    if (last > 0 && realized.every((v, m) => m === 0 || v > 0)) drawForecastCallout(chart.ctx, chart.g, last, realized[last], median && median[last]);
  }

  // Class-grade bands for the five-year chart (final GDW thresholds).
  const GRADE_BANDS = [
    { from: 60, to: 100, label: '60+ THRIVING', fill: 'rgba(181, 204, 120, 0.10)', text: '#b5cc78' },
    { from: 35, to: 60, label: '35\u201359 STABLE', fill: 'rgba(230, 198, 135, 0.07)', text: '#e6c687' },
    { from: 1, to: 35, label: '1\u201334 FRAGILE', fill: 'rgba(240, 164, 48, 0.08)', text: '#f0a430' },
    { from: 0, to: 1, label: '0 SHUTDOWN', fill: 'rgba(229, 72, 77, 0.35)', text: '#e5484d' }
  ];
  const MONTHS_PER_CYCLE = 12;

  /**
   * End Screen: the whole game's realized GDW (start + up to 60 months) on a
   * fixed 5-year axis, with the class-grade threshold bands, a vertical
   * divider at the end of each cycle and YEAR 1..5 labels. A game that shut
   * down early draws its line up to the collapse and leaves the rest empty.
   * `cycleMarkers` ([{ cycle, index }]) place the dividers; without them the
   * dividers fall every 12 months. Returns { ctx, g } or null.
   */
  function drawFullHistoryChart(gdwHistory, canvas, { cycleMarkers = null, cycles = 5, lineColor = COLORS.realized } = {}) {
    if (!canvas && typeof document !== 'undefined') canvas = document.getElementById('end-history-chart');
    if (!canvas || !canvas.getContext) return null;
    const history = (Array.isArray(gdwHistory) ? gdwHistory : []).filter((v) => typeof v === 'number' && isFinite(v));
    const months = Math.max(cycles * MONTHS_PER_CYCLE, history.length - 1);
    const { ctx } = fitCanvas(canvas);
    // Like geometry(), with a right margin that holds the band labels, so
    // the GDW line never runs over them.
    const LABEL_MARGIN = 150;
    const w = canvas.cssWidth || canvas.width;
    const h = canvas.cssHeight || canvas.height;
    const plotW = w - PAD.left - PAD.right - LABEL_MARGIN;
    const plotH = h - PAD.top - PAD.bottom;
    const g = {
      w, h, months,
      x: (m) => PAD.left + (m / months) * plotW,
      y: (gdw) => PAD.top + (1 - Math.max(0, Math.min(100, gdw)) / 100) * plotH
    };
    clear(ctx, g);
    ctx.save();
    // Threshold bands, labelled in the right margin.
    ctx.font = '300 14px Montserrat, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const b of GRADE_BANDS) {
      const top = g.y(b.to);
      const bottom = b.from === 0 ? g.y(0) + 1 : g.y(b.from);
      ctx.fillStyle = b.fill;
      ctx.fillRect(g.x(0), top, g.x(months) - g.x(0), Math.max(2, bottom - top));
      ctx.fillStyle = b.text;
      const labelY = b.from === 0 ? g.y(0) : (top + bottom) / 2;
      ctx.fillText(b.label, g.x(months) + 12, labelY);
    }
    ctx.textAlign = 'right';
    // Gridlines and GDW labels every 20%.
    ctx.font = '300 15px Montserrat, sans-serif';
    for (let v = 0; v <= 100; v += 20) {
      ctx.strokeStyle = v === 0 ? COLORS.axis : COLORS.grid;
      ctx.lineWidth = v === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(g.x(0), g.y(v));
      ctx.lineTo(g.x(months), g.y(v));
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${v}%`, g.x(0) - 10, g.y(v));
    }
    // Cycle dividers (dashed) and YEAR labels centred in each cycle.
    const ends = cycleMarkers && cycleMarkers.length
      ? cycleMarkers.map((m) => m.index)
      : Array.from({ length: cycles }, (_, i) => (i + 1) * MONTHS_PER_CYCLE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.setLineDash([5, 6]);
    for (let c = 0; c < cycles; c++) {
      const start = c * MONTHS_PER_CYCLE;
      const end = (c + 1) * MONTHS_PER_CYCLE;
      if (c < cycles - 1) {
        ctx.strokeStyle = 'rgba(125, 138, 154, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x(end), g.y(100));
        ctx.lineTo(g.x(end), g.y(0));
        ctx.stroke();
      }
      ctx.fillStyle = c < ends.length ? COLORS.text : 'rgba(125, 138, 154, 0.45)';
      ctx.fillText(`YEAR ${c + 1}`, g.x((start + end) / 2), g.y(0) + 10);
    }
    ctx.setLineDash([]);
    ctx.restore();
    // The realized line, with a dot on each cycle's closing month.
    line(ctx, g, history, { color: lineColor, width: 4 });
    ctx.save();
    ctx.fillStyle = lineColor;
    for (const i of ends) {
      if (i < history.length) {
        ctx.beginPath();
        ctx.arc(g.x(i), g.y(history[i]), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return { ctx, g, months };
  }

  window.SocietelosCharts = { COLORS, PAD, fitCanvas, geometry, drawAxes, line, band, drawForecastFan, animateRealizedLine, cancelAnimation, render, forecastVerdict, redraw, drawFullHistoryChart, GRADE_BANDS };
})();
