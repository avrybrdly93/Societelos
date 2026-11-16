'use strict';

// One simulated month for every cohort. Pure functions over the state's trait
// buffer; randomness only from the PRNG passed in.

const { clamp01, cloneState, computeGDW, computeDistrictWellbeing } = require('./state');
const { mulberry32, randomNormal, randomUniform } = require('./prng');

/**
 * Precompute everything a run needs from the config so stepMonth does no
 * lookups by name. Sensitivity becomes a flat Float64Array aligned with the
 * trait buffer.
 * @param {object} state a state from createInitialState
 * @param {object} [opts] { alpha, volatility, sensitivityScale(i, k) => multiplier }
 */
// Topology depends only on the config and cohort list, so it is computed once
// per state lineage and shared by every Monte Carlo run.
const topologyCache = new WeakMap();

function getTopology(state) {
  let topo = topologyCache.get(state.cohorts);
  if (topo) return topo;
  const cfg = state.config;
  const districtIds = cfg.districts.map((d) => d.id);
  const cohortsByDistrict = districtIds.map((id) => state.cohorts.map((co, i) => (co.district === id ? i : -1)).filter((i) => i >= 0));
  const indexOf = new Map(state.cohorts.map((co, i) => [co.key, i]));
  const neighbourCohorts = state.cohorts.map((co) => {
    const district = cfg.districts.find((d) => d.id === co.district);
    return (district.neighbours || []).map((nid) => indexOf.get(`${nid}:${co.cohort}`)).filter((i) => i !== undefined);
  });
  const K = state.traitNames.length;
  const baseS = new Float64Array(state.cohorts.length * K);
  state.cohorts.forEach((cohort, i) => {
    const row = cfg.sensitivity[cohort.key] || {};
    state.traitNames.forEach((t, k) => { baseS[i * K + k] = typeof row[t] === 'number' ? row[t] : 1; });
  });
  // Population weight of each cohort (sums to 1) and trait weights, for fast GDW.
  const totalPop = state.cohorts.reduce((a, c) => a + c.population, 0);
  const popWeight = Float64Array.from(state.cohorts, (c) => c.population / totalPop);
  const traitWeight = Float64Array.from(state.traitNames, (t) => cfg.weights[t] || 0);
  const c = cfg.constants;
  const tau = c.adoptionTau;
  const maxMonths = (c.monthsPerCycle || 12) + 1;
  const adoptionIncrements = new Float64Array(maxMonths);
  for (let m = 1; m < maxMonths; m++) {
    adoptionIncrements[m] = (1 - Math.exp(-m / tau)) - (1 - Math.exp(-(m - 1) / tau));
  }
  topo = {
    districtIds,
    cohortsByDistrict,
    neighbourCohorts,
    baseS,
    popWeight,
    traitWeight,
    adoptionIncrements,
    driftIdx: (c.driftTraits || []).map((t) => state.traitNames.indexOf(t)).filter((k) => k >= 0)
  };
  topologyCache.set(state.cohorts, topo);
  return topo;
}

/**
 * Precompute everything a run needs from the config so stepMonth does no
 * lookups by name. Sensitivity becomes a flat Float64Array aligned with the
 * trait buffer.
 * @param {object} state a state from createInitialState
 * @param {object} [opts] { alpha, volatility, sensitivityScale(i, k) => multiplier }
 */
function buildParams(state, opts = {}) {
  const c = state.config.constants;
  const K = state.traitNames.length;
  const n = state.cohorts.length;
  const topo = getTopology(state);

  let S = topo.baseS;
  if (opts.sensitivityScale) {
    S = new Float64Array(topo.baseS.length);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < K; k++) S[i * K + k] = topo.baseS[i * K + k] * opts.sensitivityScale(i, k);
    }
  }

  let e = opts.effectVector || opts.e || null;
  if (!e && opts.effects) {
    e = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const v = opts.effects[state.traitNames[k]];
      e[k] = typeof v === 'number' ? v : 0;
    }
  }

  return {
    K,
    n,
    alpha: typeof opts.alpha === 'number' ? opts.alpha : c.alpha,
    volatility: typeof opts.volatility === 'number' ? opts.volatility : 1,
    S,
    e,
    constants: c,
    districtIds: topo.districtIds,
    cohortsByDistrict: topo.cohortsByDistrict,
    neighbourCohorts: topo.neighbourCohorts,
    driftIdx: topo.driftIdx,
    popWeight: topo.popWeight,
    traitWeight: topo.traitWeight,
    adoptionIncrements: topo.adoptionIncrements
  };
}

/** Fast GDW from the trait buffer using precomputed weights. */
function fastGdw(state, params) {
  const { K, n, popWeight, traitWeight } = params;
  const t = state.traits;
  let w = 0;
  for (let i = 0; i < n; i++) {
    let cw = 0;
    for (let k = 0; k < K; k++) cw += traitWeight[k] * t[i * K + k];
    w += popWeight[i] * cw;
  }
  return computeGDW(w, state.config.gdw);
}

/**
 * Advance the state by one month (monthIndex = 1..12) under effect vector
 * `effects` ({ trait: -1..1 }). Mutates state.traits; returns { shocks }.
 */
function stepMonth(state, effects, monthIndex, params, rng, shocksOut) {
  const shocks = shocksOut || (shocksOut === null ? null : []);
  applyAdoption(state, effects, monthIndex, params);
  applyDrift(state, params);
  applyNoise(state, params, rng);
  applyShocks(state, monthIndex, params, rng, shocks);
  applySpillover(state, params);
  clampTraits(state);
  state.month = monthIndex;
  return { shocks: shocks || [] };
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
  const { K, n, S, alpha, adoptionIncrements } = params;
  const increment = (adoptionIncrements && adoptionIncrements[monthIndex] !== undefined)
    ? adoptionIncrements[monthIndex]
    : (adoptedShare(monthIndex, params.constants.adoptionTau) - adoptedShare(monthIndex - 1, params.constants.adoptionTau));
  const e = params.e || state.traitNames.map((t) => (typeof effects[t] === 'number' ? effects[t] : 0));
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
  const len = t.length;
  for (let j = 0; j < len; j += 2) {
    const u1 = 1 - rng();
    const u2 = rng();
    const radius = sd * Math.sqrt(-2 * Math.log(u1));
    const theta = 6.283185307179586 * u2;
    t[j] += radius * Math.cos(theta);
    if (j + 1 < len) t[j + 1] += radius * Math.sin(theta);
  }
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
  if (!params.scratch || params.scratch.length !== t.length) params.scratch = new Float64Array(t.length);
  const snapshot = params.scratch;
  snapshot.set(t);
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

/** Snapshot of every district's wellbeing: { D1: w, ... }. */
function districtSnapshot(state, districtIds) {
  const out = {};
  for (const id of districtIds) out[id] = computeDistrictWellbeing(state, id);
  return out;
}

/**
 * Run one 12-month simulation from `initialState` (left untouched).
 * opts: { volatility, trackDistricts (default: realized runs only) }
 * A forecast run redraws the model's uncertain parameters from the seed:
 * alpha ~ N(alpha, alphaSD) clamped, and every sensitivity x U(0.8, 1.2).
 * The realized run (isForecast = false) uses the base parameters.
 * @returns {{ seed, gdw: number[], districts: object[], shocks: object[], finalState }}
 *   gdw and districts have monthsPerCycle + 1 entries (month 0 = start).
 */
function runSingleSimulation(initialState, effects, seed, isForecast = false, opts = {}) {
  const c = initialState.config.constants;
  const rng = mulberry32(seed);
  const state = cloneState(initialState);
  const paramOpts = { volatility: opts.volatility, effects, effectVector: opts.effectVector };
  if (isForecast) {
    const a = randomNormal(rng, c.alpha, c.alphaSD);
    paramOpts.alpha = Math.min(c.alphaMax, Math.max(c.alphaMin, a));
    paramOpts.sensitivityScale = () => randomUniform(rng, c.sensitivityJitterMin, c.sensitivityJitterMax);
  }
  const params = buildParams(state, paramOpts);
  // Forecast runs only need the GDW line; district snapshots are for the realized run's map.
  const trackDistricts = opts.trackDistricts !== undefined ? opts.trackDistricts : !isForecast;
  const trackShocks = !isForecast || !!opts.trackShocks;
  const months = c.monthsPerCycle;
  const gdw = new Float64Array(months + 1);
  gdw[0] = fastGdw(state, params);
  const districts = trackDistricts ? [districtSnapshot(state, params.districtIds)] : [];
  const shocks = trackShocks ? [] : null;
  for (let m = 1; m <= months; m++) {
    stepMonth(state, effects, m, params, rng, shocks);
    gdw[m] = fastGdw(state, params);
    if (trackDistricts) districts.push(districtSnapshot(state, params.districtIds));
  }
  state.month = 0;
  return { seed, gdw, districts, shocks: shocks || [], finalState: state };
}

module.exports = {
  fastGdw,
  getTopology,
  runSingleSimulation,
  districtSnapshot, buildParams, stepMonth, adoptedShare, applyAdoption, applyDrift, applyNoise, applyShocks, applySpillover, clampTraits, clamp01 };
