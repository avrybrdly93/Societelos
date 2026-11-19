// Societelos: Deterministic Cohort-Based Monte Carlo Simulation Engine

// Seeded PRNG: Mulberry32
function createPrng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 5 Districts Definition
const DISTRICTS = [
  { id: 'D1', name: 'Aurelia', population: 30000, elitePct: 0.05 },
  { id: 'D2', name: 'Capitol', population: 55000, elitePct: 0.01 },
  { id: 'D3', name: 'Obsidian-Chasm', population: 65000, elitePct: 0.01 },
  { id: 'D4', name: 'Sector V Commons', population: 60000, elitePct: 0.01 },
  { id: 'D5', name: 'Twilight Promenade', population: 40000, elitePct: 0.005 }
];

// Initial Cohort State Generator
function createInitialState() {
  const cohorts = [];

  DISTRICTS.forEach((district) => {
    const pop = district.population;
    const elitePop = Math.round(pop * district.elitePct);
    const remainingPop = pop - elitePop;

    const cohortDefs = [
      { type: 'youth', weight: 0.25, pop: Math.round(remainingPop * 0.25), offset: { purpose: -0.05, autonomy: 0.05, connection: -0.05 } },
      { type: 'workers', weight: 0.45, pop: Math.round(remainingPop * 0.45), offset: { purpose: -0.1, fairness: -0.05 } },
      { type: 'elders', weight: 0.29, pop: Math.round(remainingPop * 0.29), offset: { health: -0.05, trust: 0.05 } },
      { type: 'elite', weight: 0.01, pop: elitePop, offset: { fairness: 0.15, autonomy: 0.1, health: 0.1 } }
    ];

    cohortDefs.forEach((c) => {
      cohorts.push({
        districtId: district.id,
        districtName: district.name,
        type: c.type,
        population: c.pop,
        traits: {
          purpose: Math.max(0, Math.min(1, 0.35 + (c.offset.purpose || 0))),
          connection: Math.max(0, Math.min(1, 0.38 + (c.offset.connection || 0))),
          health: Math.max(0, Math.min(1, 0.42 + (c.offset.health || 0))),
          trust: Math.max(0, Math.min(1, 0.30 + (c.offset.trust || 0))),
          fairness: Math.max(0, Math.min(1, 0.28 + (c.offset.fairness || 0))),
          autonomy: Math.max(0, Math.min(1, 0.32 + (c.offset.autonomy || 0)))
        }
      });
    });
  });

  return cohorts;
}

// Compute aggregate Gross Domestic Well-Being (GDW) in [0, 100]
function computeGdw(cohorts) {
  let totalWeightedWellbeing = 0;
  let totalPopulation = 0;

  cohorts.forEach((cohort) => {
    const t = cohort.traits;
    // Wellbeing is a balanced composite of human telos traits
    const wellbeing =
      t.purpose * 0.25 +
      t.connection * 0.20 +
      t.health * 0.15 +
      t.trust * 0.10 +
      t.fairness * 0.15 +
      t.autonomy * 0.15;

    totalWeightedWellbeing += wellbeing * cohort.population;
    totalPopulation += cohort.population;
  });

  const rawRatio = totalWeightedWellbeing / (totalPopulation || 1);
  return Math.round(Math.max(0, Math.min(100, rawRatio * 100)));
}

// Step cohorts forward through 12 simulated months
function stepCohorts(cohorts, policyEffects, prng, volatility = 1.0) {
  const updated = cohorts.map((cohort) => {
    const traits = { ...cohort.traits };

    for (const [trait, delta] of Object.entries(policyEffects || {})) {
      if (traits[trait] !== undefined) {
        // Month-by-month stochastic drift + policy impact
        const noise = (prng() - 0.5) * 0.06 * volatility;
        const netDelta = (delta * 0.18) + noise;
        traits[trait] = Math.max(0.01, Math.min(0.99, traits[trait] + netDelta));
      }
    }

    return {
      ...cohort,
      traits
    };
  });

  return updated;
}

// Run 500-run Monte Carlo forecast + 1 realized run
function runSimulationCycle(currentCohorts, policyEffects, cycleSeed, volatility = 1.0) {
  const forecastRuns = 500;
  const forecastGdwPoints = [];

  // 1. Run 500 stochastic forecast projections
  for (let i = 0; i < forecastRuns; i++) {
    const forecastPrng = createPrng(cycleSeed + 1000 + i);
    const projected = stepCohorts(currentCohorts, policyEffects, forecastPrng, volatility);
    forecastGdwPoints.push(computeGdw(projected));
  }

  forecastGdwPoints.sort((a, b) => a - b);
  const p10 = forecastGdwPoints[Math.floor(forecastRuns * 0.10)];
  const median = forecastGdwPoints[Math.floor(forecastRuns * 0.50)];
  const p90 = forecastGdwPoints[Math.floor(forecastRuns * 0.90)];

  // 2. Realized authoritative run (seeded strictly by cycle)
  const realizedPrng = createPrng(cycleSeed + 42);
  const realizedCohorts = stepCohorts(currentCohorts, policyEffects, realizedPrng, volatility);
  const realizedGdw = computeGdw(realizedCohorts);

  // District breakdowns
  const districtSummaries = DISTRICTS.map((d) => {
    const distCohorts = realizedCohorts.filter((c) => c.districtId === d.id);
    const distGdw = computeGdw(distCohorts);
    return {
      id: d.id,
      name: d.name,
      population: d.population,
      gdw: distGdw
    };
  });

  return {
    realizedCohorts,
    realizedGdw,
    forecast: {
      p10,
      median,
      p90
    },
    districtSummaries
  };
}

module.exports = {
  DISTRICTS,
  createInitialState,
  computeGdw,
  stepCohorts,
  runSimulationCycle
};
