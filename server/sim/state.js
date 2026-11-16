'use strict';

// Cohort state for the simulation: 5 districts x 4 cohorts = 20 cohorts, each
// with 6 traits in [0, 1]. Pure functions, no I/O: the caller passes the parsed
// data/sim.json as `simConfig`.
//
// Layout: traits live in one Float64Array (cohort-major, 6 per cohort) so a
// Monte Carlo run can copy and update state without allocating objects.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Build the starting state from data/sim.json.
 * @returns {{ config, traitNames: string[], cohorts: object[], traits: Float64Array, month: number }}
 */
function createInitialState(simConfig) {
  const traitNames = simConfig.traits;
  const K = traitNames.length;
  const defaultShares = Object.fromEntries(simConfig.cohorts.map((c) => [c.id, c.share]));
  const districtOffsets = (simConfig.offsets && simConfig.offsets.districts) || {};
  const cohortOffsets = (simConfig.offsets && simConfig.offsets.cohorts) || {};

  const cohorts = [];
  for (const district of simConfig.districts) {
    const shares = (simConfig.cohortSharesByDistrict && simConfig.cohortSharesByDistrict[district.id]) || defaultShares;
    for (const cohort of simConfig.cohorts) {
      cohorts.push({
        key: `${district.id}:${cohort.id}`,
        district: district.id,
        cohort: cohort.id,
        population: district.population * shares[cohort.id]
      });
    }
  }

  const traits = new Float64Array(cohorts.length * K);
  cohorts.forEach((c, i) => {
    traitNames.forEach((t, k) => {
      const offset = ((districtOffsets[c.district] || {})[t] || 0) + ((cohortOffsets[c.cohort] || {})[t] || 0);
      traits[i * K + k] = clamp01(simConfig.baseline + offset);
    });
  });

  return { config: simConfig, traitNames, cohorts, traits, month: 0 };
}

/**
 * Fast copy for Monte Carlo runs: config, trait names and cohort metadata are
 * immutable and shared; only the trait buffer is copied.
 */
function cloneState(state) {
  return {
    config: state.config,
    traitNames: state.traitNames,
    cohorts: state.cohorts,
    traits: new Float64Array(state.traits),
    month: state.month
  };
}

/**
 * Cohort wellbeing W = sum_k weight_k * trait_k.
 * @param {object} traits { purpose, connection, health, trust, fairness, autonomy }
 * @param {object} weights same keys (data/sim.json "weights")
 */
function computeCohortWellbeing(traits, weights) {
  let w = 0;
  for (const k of Object.keys(weights)) w += weights[k] * (traits[k] || 0);
  return w;
}

/** Wellbeing of cohort index i read straight from the trait buffer. */
function cohortWellbeingAt(state, i) {
  const { traitNames, traits, config } = state;
  const K = traitNames.length;
  let w = 0;
  for (let k = 0; k < K; k++) w += config.weights[traitNames[k]] * traits[i * K + k];
  return w;
}

/** Traits of cohort index i as a plain object. */
function cohortTraits(state, i) {
  const K = state.traitNames.length;
  const out = {};
  state.traitNames.forEach((t, k) => { out[t] = state.traits[i * K + k]; });
  return out;
}

/**
 * District wellbeing: mean of its cohorts' W weighted by cohort population.
 */
function computeDistrictWellbeing(state, districtId) {
  let sum = 0;
  let pop = 0;
  state.cohorts.forEach((c, i) => {
    if (c.district !== districtId) return;
    sum += cohortWellbeingAt(state, i) * c.population;
    pop += c.population;
  });
  return pop > 0 ? sum / pop : 0;
}

/** Population-weighted mean wellbeing W of the whole region. */
function computeRegionWellbeing(state) {
  let sum = 0;
  let pop = 0;
  state.cohorts.forEach((c, i) => {
    sum += cohortWellbeingAt(state, i) * c.population;
    pop += c.population;
  });
  return pop > 0 ? sum / pop : 0;
}

/**
 * GDW = clamp(scale * (W - floor), min, max) = clamp(125 * (W - 0.20), 0, 100).
 * Rounded to 1e-9 so the starting state reads exactly 25.
 * Accepts a state, or a wellbeing number plus the gdw config.
 */
function computeGDW(stateOrW, gdwConfig) {
  const cfg = gdwConfig || (stateOrW && stateOrW.config && stateOrW.config.gdw) || { scale: 125, floorWellbeing: 0.2, min: 0, max: 100 };
  const w = typeof stateOrW === 'number' ? stateOrW : computeRegionWellbeing(stateOrW);
  const raw = cfg.scale * (w - cfg.floorWellbeing);
  const clamped = Math.min(cfg.max, Math.max(cfg.min, raw));
  return Math.round(clamped * 1e9) / 1e9;
}

module.exports = {
  computeRegionWellbeing,
  computeGDW,
  createInitialState,
  cloneState,
  clamp01,
  computeCohortWellbeing,
  cohortWellbeingAt,
  cohortTraits,
  computeDistrictWellbeing
};
