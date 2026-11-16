'use strict';

// Societelos — finale (cycle 5) arithmetic: Borda count, its tie-breaker, the
// 50/25/25 enactment and the package effect vector. Pure functions; the
// game engine owns the phases, ballots and scoring around them.

// Finale Borda points by rank position (1st..4th).
const BORDA_POINTS = Object.freeze([4, 3, 2, 1]);

/**
 * Borda count over the finale ballots. `ranks` is { node: [id x4] } (best
 * first). Returns { policyId: { points, places: [n1st, n2nd, n3rd, n4th] } }
 * for every policy that appears; with 5 voters each policy gets 4 rankings
 * (max 16 points).
 */
function bordaCount(ranks, policyIds = []) {
  const tally = {};
  for (const id of policyIds) tally[id] = { points: 0, places: [0, 0, 0, 0] };
  for (const order of Object.values(ranks || {})) {
    (order || []).slice(0, BORDA_POINTS.length).forEach((id, i) => {
      if (!tally[id]) tally[id] = { points: 0, places: [0, 0, 0, 0] };
      tally[id].points += BORDA_POINTS[i];
      tally[id].places[i] += 1;
    });
  }
  return tally;
}

/**
 * Order policies by Borda result. Ties break on most 1st places, then most
 * 2nd places, then the higher single-policy forecast median GDW
 * (`medianOf(id)`, computed only when needed), then policy id for stability.
 * Returns [{ id, points, places, median? }] best first.
 */
function rankBorda(tally, medianOf = () => 0) {
  const medians = {};
  const median = (id) => (id in medians ? medians[id] : (medians[id] = Number(medianOf(id)) || 0));
  const rows = Object.entries(tally).map(([id, t]) => ({ id, points: t.points, places: t.places.slice() }));
  rows.sort((a, b) => (
    b.points - a.points ||
    b.places[0] - a.places[0] ||
    b.places[1] - a.places[1] ||
    median(b.id) - median(a.id) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  ));
  for (const r of rows) if (r.id in medians) r.median = medians[r.id];
  return rows;
}

// Enactment weights for the top three finale policies.
const FINALE_WEIGHTS = Object.freeze([0.5, 0.25, 0.25]);
const FINALE_PLACES = Object.freeze(['first', 'second', 'third']);
const FINALE_ROLE_POINTS = Object.freeze({ first: 2, second: 1, third: 1 });

/** The top three of a rankBorda() result: [{ id, place, weight, points }]. */
function selectEnacted(rows) {
  return rows.slice(0, FINALE_WEIGHTS.length).map((r, i) => ({ id: r.id, place: FINALE_PLACES[i], weight: FINALE_WEIGHTS[i], points: r.points }));
}

const TRAITS = Object.freeze(['purpose', 'connection', 'health', 'trust', 'fairness', 'autonomy']);

/**
 * The finale package effect vector: e(k) = 0.50 e1(k) + 0.25 e2(k) + 0.25 e3(k)
 * for each trait, so opposing policies cancel. `enacted` is selectEnacted()
 * output; `effectsOf(id)` returns a policy's vector. Clamped to [-1, 1].
 */
function packageEffects(enacted, effectsOf) {
  const out = {};
  for (const t of TRAITS) {
    let v = 0;
    for (const { id, weight } of enacted) {
      const e = effectsOf(id) || {};
      v += weight * (typeof e[t] === 'number' ? e[t] : 0);
    }
    out[t] = Math.round(Math.max(-1, Math.min(1, v)) * 1e6) / 1e6;
  }
  return out;
}

module.exports = {
  BORDA_POINTS,
  FINALE_WEIGHTS,
  FINALE_PLACES,
  FINALE_ROLE_POINTS,
  TRAITS,
  bordaCount,
  rankBorda,
  selectEnacted,
  packageEffects
};
