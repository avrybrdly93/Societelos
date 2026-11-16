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
 * A recurring citizen's mood: the simulated state of their own
 * (district, cohort). Returns { key, district, cohort, wellbeing, gdw, traits }
 * or null when the citizen's cohort is not in the state.
 * @param {object} state sim state
 * @param {{ district: string, cohort: string }} citizen e.g. Mara (D3, workers)
 */
function getCitizenMood(state, citizen) {
  if (!state || !citizen) return null;
  const i = state.cohorts.findIndex((c) => c.district === citizen.district && c.cohort === citizen.cohort);
  if (i < 0) return null;
  const wellbeing = cohortWellbeingAt(state, i);
  return {
    key: state.cohorts[i].key,
    district: citizen.district,
    cohort: citizen.cohort,
    wellbeing,
    gdw: computeGDW(wellbeing, state.config.gdw),
    traits: cohortTraits(state, i)
  };
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

/**
 * Check a parsed data/sim.json has everything createInitialState and the
 * monthly step need. Returns an array of error strings (empty = valid).
 */
function validateSimConfig(cfg) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!cfg || typeof cfg !== 'object') return ['config missing'];
  need(Array.isArray(cfg.traits) && cfg.traits.length === 6, 'traits must list the 6 traits');
  const traits = cfg.traits || [];
  need(cfg.gdw && ['scale', 'floorWellbeing', 'min', 'max'].every((k) => typeof cfg.gdw[k] === 'number'), 'gdw needs scale, floorWellbeing, min, max');
  need(Array.isArray(cfg.districts) && cfg.districts.length === 5, 'districts must have 5 entries');
  const ids = (cfg.districts || []).map((d) => d.id);
  (cfg.districts || []).forEach((d) => {
    need(d.population > 0, `${d.id}: population must be > 0`);
    (d.neighbours || []).forEach((n) => need(ids.includes(n), `${d.id}: unknown neighbour ${n}`));
    (d.neighbours || []).forEach((n) => {
      const other = cfg.districts.find((x) => x.id === n);
      need(other && (other.neighbours || []).includes(d.id), `${d.id}-${n}: neighbours must be symmetric`);
    });
  });
  need(Array.isArray(cfg.cohorts) && cfg.cohorts.length === 4, 'cohorts must have 4 entries');
  const shareSum = (cfg.cohorts || []).reduce((a, c) => a + c.share, 0);
  need(Math.abs(shareSum - 1) < 1e-9, `cohort shares sum to ${shareSum}, not 1`);
  for (const [d, shares] of Object.entries(cfg.cohortSharesByDistrict || {})) {
    const sum = Object.values(shares).reduce((a, b) => a + b, 0);
    need(Math.abs(sum - 1) < 1e-9, `${d} cohort shares sum to ${sum}, not 1`);
  }
  const wSum = traits.reduce((a, t) => a + ((cfg.weights || {})[t] || 0), 0);
  need(Math.abs(wSum - 1) < 1e-9, `trait weights sum to ${wSum}, not 1`);
  need(typeof cfg.baseline === 'number', 'baseline must be a number');
  for (const d of ids) {
    for (const c of (cfg.cohorts || []).map((x) => x.id)) {
      const row = (cfg.sensitivity || {})[`${d}:${c}`];
      need(!!row, `sensitivity ${d}:${c} missing`);
      if (row) traits.forEach((t) => need(typeof row[t] === 'number' && row[t] >= -1.5 && row[t] <= 1.5, `sensitivity ${d}:${c}.${t} must be in [-1.5, 1.5]`));
    }
  }
  const k = cfg.constants || {};
  ['alpha', 'alphaSD', 'adoptionTau', 'hedonicDrift', 'noiseSD', 'shockChance', 'shockMin', 'shockMax', 'spilloverRate', 'forecastRuns', 'monthsPerCycle']
    .forEach((name) => need(typeof k[name] === 'number', `constants.${name} must be a number`));
  if (!errors.length) {
    const gdw = computeGDW(createInitialState(cfg));
    need(Math.abs(gdw - cfg.gdw.startingGdw) < 1e-6, `starting GDW is ${gdw}, expected ${cfg.gdw.startingGdw}`);
  }
  return errors;
}

module.exports = {
  validateSimConfig,
  computeRegionWellbeing,
  computeGDW,
  createInitialState,
  cloneState,
  clamp01,
  computeCohortWellbeing,
  cohortWellbeingAt,
  cohortTraits,
  getCitizenMood,
  computeDistrictWellbeing
};
