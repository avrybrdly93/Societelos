// Societelos — region map controller.
// Colours each SVG district from its cohort wellbeing W (population-weighted).
(function () {
  'use strict';

  const DISTRICT_IDS = ['D1', 'D2', 'D3', 'D4', 'D5'];

  function districtGroup(id) {
    return document.getElementById(`district-${id}`);
  }

  /** Set one district's fill to a CSS colour string. */
  function setDistrictColor(id, color) {
    const g = districtGroup(id);
    if (g) g.style.setProperty('--district-fill', color);
  }

  // Colour stops: critical red at W <= 0.20 (GDW 0%), amber at W = 0.40
  // (GDW 25%), thriving teal at W >= 0.68 (GDW 60%).
  const STOPS = [
    { w: 0.20, rgb: [229, 72, 77] },
    { w: 0.40, rgb: [240, 164, 48] },
    { w: 0.68, rgb: [43, 196, 160] }
  ];

  /** Interpolate a wellbeing value W in [0, 1] to an rgb() colour string. */
  function wellbeingToColor(w) {
    const v = Number.isFinite(w) ? w : STOPS[0].w;
    if (v <= STOPS[0].w) return `rgb(${STOPS[0].rgb.join(', ')})`;
    const last = STOPS[STOPS.length - 1];
    if (v >= last.w) return `rgb(${last.rgb.join(', ')})`;
    for (let i = 0; i < STOPS.length - 1; i++) {
      const a = STOPS[i];
      const b = STOPS[i + 1];
      if (v <= b.w) {
        const t = (v - a.w) / (b.w - a.w);
        const rgb = a.rgb.map((c, k) => Math.round(c + (b.rgb[k] - c) * t));
        return `rgb(${rgb.join(', ')})`;
      }
    }
    return `rgb(${last.rgb.join(', ')})`;
  }

  /**
   * Colour every district. `districts` is an array of { id, wellbeing } or
   * a map { D1: wellbeing, ... }. `toColor` turns a wellbeing value into a colour.
   */
  function renderDistricts(districts, toColor = wellbeingToColor) {
    const values = Array.isArray(districts)
      ? Object.fromEntries(districts.map((d) => [d.id, d.wellbeing]))
      : districts || {};
    DISTRICT_IDS.forEach((id) => {
      if (typeof values[id] === 'number') setDistrictColor(id, toColor(values[id]));
    });
  }

  // Month-by-month playback during Resolution. `districtsByMonth` is the
  // resolution payload's districts array: [{ D1: W, ... D5: W }, ...] for
  // months 0-12. Fills transition smoothly (CSS) over one month's duration.
  let playback = null;

  // Shock alert badges: a crimson tag over a district for a couple of
  // seconds when a monthly shock fires there during playback.
  const SHOCK_LABELS = {
    purpose: 'PURPOSE', connection: 'CONNECTION', health: 'HEALTH',
    trust: 'TRUST', fairness: 'FAIRNESS', autonomy: 'AUTONOMY'
  };
  const SHOCK_BADGE_MS = 2600;
  function districtCenter(group) {
    const label = group.querySelector('.district-label');
    if (label) return { x: Number(label.getAttribute('x')), y: Number(label.getAttribute('y')) };
    const box = group.getBBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  function showShock(shock) {
    const group = districtGroup(shock.district);
    if (!group) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const { x, y } = districtCenter(group);
    // Outer group positions (SVG transform attribute); the inner group runs
    // the CSS pop-in animation, so the two transforms never fight.
    const badge = document.createElementNS(svgNS, 'g');
    badge.setAttribute('class', 'shock-badge');
    badge.setAttribute('transform', `translate(${x}, ${y - 46})`);
    const inner = document.createElementNS(svgNS, 'g');
    inner.setAttribute('class', 'shock-badge-inner');
    const text = `\u26A0 SHOCK: ${SHOCK_LABELS[shock.trait] || String(shock.trait || '').toUpperCase()}`;
    const width = 14 + text.length * 8.2;
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(-width / 2));
    rect.setAttribute('y', '-14');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', '24');
    rect.setAttribute('rx', '6');
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('y', '3');
    label.textContent = text;
    inner.append(rect, label);
    badge.appendChild(inner);
    group.parentNode.appendChild(badge); // above every district
    group.classList.add('is-shocked');
    setTimeout(() => {
      badge.remove();
      group.classList.remove('is-shocked');
    }, SHOCK_BADGE_MS);
  }
  function clearShocks() {
    document.querySelectorAll('#region-map .shock-badge').forEach((b) => b.remove());
    document.querySelectorAll('#region-map .is-shocked').forEach((g) => g.classList.remove('is-shocked'));
  }

  /** Start a playback at month 0; later months come from onMonthTick. */
  function startPlayback(districtsByMonth, msPerMonth = 1000, shocks = []) {
    clearShocks();
    clearDeltas();
    clearPulses();
    playback = { months: Array.isArray(districtsByMonth) ? districtsByMonth : [], msPerMonth, shocks: Array.isArray(shocks) ? shocks : [] };
    const svg = document.getElementById('region-map');
    if (svg) svg.style.setProperty('--district-transition', `${Math.max(200, msPerMonth * 0.9)}ms`);
    showMonth(0);
  }

  // Floating month indicator (MONTH 1 / 12 .. MONTH 12 / 12), stepped by the
  // same onMonthTick that advances the chart line so the two stay in sync.
  function setMonthIndicator(monthIndex) {
    const box = document.getElementById('map-month');
    const num = document.getElementById('map-month-num');
    if (!box || !num) return;
    if (monthIndex === null) { box.hidden = true; return; }
    const total = playback ? Math.max(1, playback.months.length - 1) : 12;
    const month = Math.min(total, Math.max(1, monthIndex));
    const totalEl = document.getElementById('map-month-total');
    if (totalEl) totalEl.textContent = String(total);
    if (box.hidden || num.textContent !== String(month)) {
      num.textContent = String(month);
      box.classList.remove('is-tick');
      void box.offsetWidth; // restart the tick animation
      box.classList.add('is-tick');
    }
    box.hidden = false;
    box.classList[month >= total ? 'add' : 'remove']('is-final');
  }

  // Pulse rings: a district whose wellbeing jumps or drops by at least
  // PULSE_THRESHOLD (W, so 0.015 = 1.5 points) in one month emits an
  // expanding teal (up) or crimson (down) ring from its centre.
  const PULSE_THRESHOLD = 0.015;
  const PULSE_MS = 1400;
  function showPulse(id, direction) {
    const group = districtGroup(id);
    if (!group) return;
    const { x, y } = districtCenter(group);
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('class', `district-pulse is-${direction}`);
    ring.setAttribute('cx', String(x));
    ring.setAttribute('cy', String(y));
    ring.setAttribute('r', '18');
    group.parentNode.appendChild(ring); // above every district
    setTimeout(() => ring.remove(), PULSE_MS);
  }
  function pulseLargeShifts(prev, next) {
    if (!prev || !next) return;
    DISTRICT_IDS.forEach((id) => {
      if (typeof prev[id] !== 'number' || typeof next[id] !== 'number') return;
      const delta = next[id] - prev[id];
      if (Math.abs(delta) >= PULSE_THRESHOLD) showPulse(id, delta > 0 ? 'up' : 'down');
    });
  }
  function clearPulses() {
    document.querySelectorAll('#region-map .district-pulse').forEach((r) => r.remove());
  }

  /** onMonthTick(monthIndex): colour all 5 districts for that month. */
  function showMonth(monthIndex) {
    if (!playback) return;
    const index = Math.min(monthIndex, playback.months.length - 1);
    const values = playback.months[index];
    if (values) renderDistricts(values);
    if (index > 0 && index !== playback.lastIndex) pulseLargeShifts(playback.months[index - 1], values);
    playback.lastIndex = index;
    setMonthIndicator(monthIndex);
    playback.shocks.filter((sh) => sh.month === monthIndex).forEach(showShock);
    if (monthIndex >= playback.months.length - 1) showDeltas(playback.months[0], values);
  }

  // End-of-cycle labels: each district's wellbeing change (in points of W x 100)
  // with an up/down arrow, under its name.
  const DELTA_EPSILON = 0.05;
  function clearDeltas() {
    document.querySelectorAll('#region-map .district-delta').forEach((t) => t.remove());
  }
  function showDeltas(start, end) {
    clearDeltas();
    if (!start || !end) return;
    DISTRICT_IDS.forEach((id) => {
      const group = districtGroup(id);
      if (!group || typeof start[id] !== 'number' || typeof end[id] !== 'number') return;
      const delta = (end[id] - start[id]) * 100;
      const pop = group.querySelector('.district-pop');
      const x = pop ? Number(pop.getAttribute('x')) : districtCenter(group).x;
      const y = pop ? Number(pop.getAttribute('y')) + 20 : districtCenter(group).y + 20;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const dir = delta > DELTA_EPSILON ? 'up' : delta < -DELTA_EPSILON ? 'down' : 'flat';
      text.setAttribute('class', `district-delta is-${dir}`);
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(y));
      const arrow = dir === 'up' ? '\u25B2' : dir === 'down' ? '\u25BC' : '\u25C6';
      text.textContent = `${arrow} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
      group.appendChild(text);
    });
  }

  /** Stop playback (colours stay where they are). */
  function stopPlayback() {
    playback = null;
    setMonthIndicator(null);
  }

  /**
   * host:playAgain: back to the pre-game map. Stops playback, removes shock
   * badges, pulses and delta labels, drops every district's fill (the CSS
   * default baseline shows again) and the world accent.
   */
  function reset() {
    stopPlayback();
    clearShocks();
    clearDeltas();
    clearPulses();
    DISTRICT_IDS.forEach((id) => {
      const g = districtGroup(id);
      if (g) g.style.removeProperty('--district-fill');
    });
    const svg = document.getElementById('region-map');
    if (svg) svg.style.removeProperty('--district-transition');
    setWorld(null);
  }

  // World accent colours (match the --theme-* tokens in styles.css).
  const WORLD_COLORS = { AA: '#2bc4a0', AB: '#3fd8e6', BA: '#f0a430', BB: '#c084fc' };

  /**
   * Recolour the map border, spillover links and HUD accents for the world
   * revealed after Cycle 2. Pass null to restore the default Loom cyan.
   */
  function setWorld(worldKey) {
    const svg = document.getElementById('region-map');
    if (!svg) return;
    const color = WORLD_COLORS[worldKey] || null;
    if (color) {
      svg.style.setProperty('--map-accent', color);
      svg.dataset.world = worldKey;
    } else {
      svg.style.removeProperty('--map-accent');
      delete svg.dataset.world;
    }
    svg.classList.remove('is-recoloring');
    // Restart the pulse animation so the change is noticed.
    void svg.getBoundingClientRect();
    if (color) svg.classList.add('is-recoloring');
  }

  window.SocietelosMap = { reset, DISTRICT_IDS, WORLD_COLORS, setDistrictColor, renderDistricts, wellbeingToColor, setWorld, startPlayback, showMonth, stopPlayback, showShock, clearShocks, showDeltas, clearDeltas, showPulse, PULSE_THRESHOLD };
})();
