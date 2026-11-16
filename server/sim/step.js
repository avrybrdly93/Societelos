'use strict';

// One simulated month for every cohort. Pure functions over the state's trait
// buffer; randomness only from the PRNG passed in.

const { clamp01 } = require('./state');

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

// Steps 1-6 are implemented one by one below.
function applyAdoption() {}
function applyDrift() {}
function applyNoise() {}
function applyShocks() {}
function applySpillover() {}
function clampTraits() {}

module.exports = { buildParams, stepMonth, clamp01 };
