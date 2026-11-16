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

  /**
   * Colour every district. `districts` is an array of { id, wellbeing } or
   * a map { D1: wellbeing, ... }. `toColor` turns a wellbeing value into a colour.
   */
  function renderDistricts(districts, toColor) {
    const values = Array.isArray(districts)
      ? Object.fromEntries(districts.map((d) => [d.id, d.wellbeing]))
      : districts || {};
    DISTRICT_IDS.forEach((id) => {
      if (typeof values[id] === 'number') setDistrictColor(id, toColor(values[id]));
    });
  }

  window.SocietelosMap = { DISTRICT_IDS, setDistrictColor, renderDistricts };
})();
