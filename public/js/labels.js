// Shared display labels for the projector and the phones.
// Seats are 'NODE-01'..'NODE-05' on the wire; people see "Councilperson 1".
(function () {
  'use strict';
  function councilLabel(node, { short = false } = {}) {
    const n = parseInt(String(node || '').slice(-2), 10);
    if (!Number.isFinite(n)) return short ? 'Council' : 'Councilperson';
    return short ? `Councilperson ${n}` : `Councilperson ${n}`;
  }
  window.councilLabel = councilLabel;
})();
