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

  window.SocietelosMap = { DISTRICT_IDS, setDistrictColor, renderDistricts, wellbeingToColor };
})();
