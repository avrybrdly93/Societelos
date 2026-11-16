'use strict';

// One simulated month for every cohort. Pure functions over the state's trait
// buffer; randomness only from the PRNG passed in.

const { clamp01 } = require('./state');
const { randomNormal, randomUniform } = require('./prng');

/**
 * Precompute everything a run needs from the config so stepMonth does no
 * lookups by name. Sensitivity becomes a flat Float64Array aligned with the
 * trait buffer.
 * @param {object} state a state from createInitialState
 * @param {object} [opts] { alpha, volatility, sensitivityScale(i, k) => multiplier }
 */
function buildParams(state, opts = {}) {
  const cfg = state.config;
  const c = cfg.constants;
  const K = state.traitNames.length;
  const n = state.cohorts.length;

  const S = new Float64Array(n * K);
  state.cohorts.forEach((cohort, i) => {
    const row = cfg.sensitivity[cohort.key] || {};
    state.traitNames.forEach((t, k) => {
      const base = typeof row[t] === 'number' ? row[t] : 1;
      S[i * K + k] = opts.sensitivityScale ? base * opts.sensitivityScale(i, k) : base;
    });
  });

  // District index -> cohort indices, and cohort index -> same cohort type in each neighbour.
  const districtIds = cfg.districts.map((d) => d.id);
  const cohortsByDistrict = districtIds.map((id) => state.cohorts.map((co, i) => (co.district === id ? i : -1)).filter((i) => i >= 0));
  const indexOf = new Map(state.cohorts.map((co, i) => [co.key, i]));
  const neighbourCohorts = state.cohorts.map((co) => {
    const district = cfg.districts.find((d) => d.id === co.district);
    return (district.neighbours || []).map((nid) => indexOf.get(`${nid}:${co.cohort}`)).filter((i) => i !== undefined);
  });

  return {
    K,
    n,
    alpha: typeof opts.alpha === 'number' ? opts.alpha : c.alpha,
    volatility: typeof opts.volatility === 'number' ? opts.volatility : 1,
    S,
    constants: c,
    districtIds,
    cohortsByDistrict,
    neighbourCohorts,
    driftIdx: (c.driftTraits || []).map((t) => state.traitNames.indexOf(t)).filter((k) => k >= 0)
  };
}

/**
 * Advance the state by one month (monthIndex = 1..12) under effect vector
 * `effects` ({ trait: -1..1 }). Mutates state.traits; returns { shocks }.
 */
function stepMonth(state, effects, monthIndex, params, rng) {
  const shocks = [];
  applyAdoption(state, effects, monthIndex, params);
  applyDrift(state, params);
  applyNoise(state, params, rng);
  applyShocks(state, monthIndex, params, rng, shocks);
  applySpillover(state, params);
  clampTraits(state);
  state.month = monthIndex;
  return { shocks };
}

/** Share of a policy applied by month t: 1 - exp(-t / tau). */
function adoptedShare(t, tau) {
  return 1 - Math.exp(-t / tau);
}

/**
 * Step 1, gradual adoption: this month adds the newly adopted share of the
 * full shift(c, k) = alpha * e(k) * s(c, k).
 */
function applyAdoption(state, effects, monthIndex, params) {
  if (!effects) return;
  const { K, n, S, alpha } = params;
  const tau = params.constants.adoptionTau;
  const increment = adoptedShare(monthIndex, tau) - adoptedShare(monthIndex - 1, tau);
  const e = state.traitNames.map((t) => (typeof effects[t] === 'number' ? effects[t] : 0));
  const t = state.traits;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < K; k++) {
      if (e[k] !== 0) t[i * K + k] += increment * alpha * e[k] * S[i * K + k];
    }
  }
}
/** Step 2, hedonic drift: purpose and connection fall by 0.003 a month regardless. */
function applyDrift(state, params) {
  const { K, n, driftIdx } = params;
  const drift = params.constants.hedonicDrift;
  const t = state.traits;
  for (let i = 0; i < n; i++) {
    for (const k of driftIdx) t[i * K + k] -= drift;
  }
}
/** Step 3, noise: add N(0, (noiseSD * volatility)^2) to every cohort trait. */
function applyNoise(state, params, rng) {
  const sd = params.constants.noiseSD * params.volatility;
  if (!(sd > 0)) return;
  const t = state.traits;
  for (let j = 0; j < t.length; j++) t[j] += randomNormal(rng, 0, sd);
}
/**
 * Step 4, district shocks: each district has a (shockChance * volatility)
 * chance per month of an event (outage, heatwave, viral trend) that cuts one
 * random trait by U(shockMin, shockMax) for every cohort there. Fired shocks
 * are pushed onto `out` as { month, district, trait, amount }.
 */
function applyShocks(state, monthIndex, params, rng, out) {
  const { K, constants, volatility, districtIds, cohortsByDistrict } = params;
  const chance = Math.min(1, constants.shockChance * volatility);
  const t = state.traits;
  for (let d = 0; d < districtIds.length; d++) {
    if (rng() >= chance) continue;
    const k = Math.floor(rng() * K);
    const amount = randomUniform(rng, constants.shockMin, constants.shockMax);
    for (const i of cohortsByDistrict[d]) t[i * K + k] -= amount;
    if (out) out.push({ month: monthIndex, district: districtIds[d], trait: state.traitNames[k], amount });
  }
}
/**
 * Step 5, neighbour spillover: each cohort's traits move spilloverRate (10%)
 * toward the mean of the same cohort type in neighbouring districts.
 * Computed from a snapshot so update order doesn't matter.
 */
function applySpillover(state, params) {
  const { K, n, neighbourCohorts } = params;
  const rate = params.constants.spilloverRate;
  if (!(rate > 0)) return;
  const t = state.traits;
  const snapshot = new Float64Array(t);
  for (let i = 0; i < n; i++) {
    const neighbours = neighbourCohorts[i];
    if (!neighbours.length) continue;
    for (let k = 0; k < K; k++) {
      let mean = 0;
      for (const j of neighbours) mean += snapshot[j * K + k];
      mean /= neighbours.length;
      t[i * K + k] += rate * (mean - snapshot[i * K + k]);
    }
  }
}
/** Step 6: clamp every trait to [0, 1]. */
function clampTraits(state) {
  const t = state.traits;
  for (let j = 0; j < t.length; j++) t[j] = clamp01(t[j]);
}

module.exports = { buildParams, stepMonth, adoptedShare, applyAdoption, applyDrift, applyNoise, applyShocks, applySpillover, clampTraits, clamp01 };
