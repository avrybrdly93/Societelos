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

  /** Start a playback at month 0; later months come from onMonthTick. */
  function startPlayback(districtsByMonth, msPerMonth = 1000) {
    playback = { months: Array.isArray(districtsByMonth) ? districtsByMonth : [], msPerMonth };
    const svg = document.getElementById('region-map');
    if (svg) svg.style.setProperty('--district-transition', `${Math.max(200, msPerMonth * 0.9)}ms`);
    showMonth(0);
  }

  /** onMonthTick(monthIndex): colour all 5 districts for that month. */
  function showMonth(monthIndex) {
    if (!playback) return;
    const values = playback.months[Math.min(monthIndex, playback.months.length - 1)];
    if (values) renderDistricts(values);
  }

  /** Stop playback (colours stay where they are). */
  function stopPlayback() {
    playback = null;
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

  window.SocietelosMap = { DISTRICT_IDS, WORLD_COLORS, setDistrictColor, renderDistricts, wellbeingToColor, setWorld, startPlayback, showMonth, stopPlayback };
})();
