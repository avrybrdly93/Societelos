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

module.exports = { createInitialState, clamp01 };
