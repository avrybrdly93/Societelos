'use strict';

/**
 * The 500 simulated citizens.
 *
 * Every game seeds 500 citizens, spread across the five districts and four
 * cohorts in the same proportions as data/sim.json. Each citizen holds an
 * idea vector over the six traits the simulation tracks (purpose,
 * connection, health, trust, fairness, autonomy), in [-1, 1]: how much they
 * want each one. It starts from their district+cohort sensitivity (what
 * that group reacts to in the simulation), leans towards one of the five
 * council characters, and adds personal noise.
 *
 * A citizen approves a policy when its effect vector points the same way as
 * their ideas (cosine similarity above APPROVAL_THRESHOLD). Approval feeds
 * the council's shared (group) score and the citizen bar on the projector.
 */

const TRAITS = Object.freeze(['purpose', 'connection', 'health', 'trust', 'fairness', 'autonomy']);
const CITIZEN_COUNT = 500;
const APPROVAL_THRESHOLD = 0.1;
const NOISE = 0.35;
const LEAN = 0.45; // how strongly a citizen leans towards their nearest character

/** mulberry32: small, fast, seeded PRNG in [0, 1). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

/** Trait object -> array in TRAITS order (missing traits are 0). */
function toVector(obj) {
  return TRAITS.map((t) => (obj && Number.isFinite(obj[t]) ? obj[t] : 0));
}

function dot(a, b) { return a.reduce((s, x, i) => s + x * b[i], 0); }
function norm(a) { return Math.sqrt(dot(a, a)); }

/** Cosine similarity of two vectors (0 when either is all zeros). */
function cosine(a, b) {
  const n = norm(a) * norm(b);
  return n > 1e-9 ? dot(a, b) / n : 0;
}

/** Pick an index from weights with `rand`. */
function pickWeighted(weights, rand) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Generate the citizens for one game.
 * @param {object} simConfig data/sim.json (districts, cohorts, sensitivity)
 * @param {Array}  characters data/roles.json (the five council characters, with `ideas`)
 * @param {number} seed 32-bit seed (from the game id)
 * @returns {Array<{ id, district, cohort, lean, ideas: number[] }>}
 */
function generateCitizens(simConfig, characters, seed, count = CITIZEN_COUNT) {
  const rand = prng(seed);
  const districts = (simConfig && simConfig.districts) || [{ id: 'D1', population: 1 }];
  const cohorts = (simConfig && simConfig.cohorts) || [{ id: 'all', share: 1 }];
  const sensitivity = (simConfig && simConfig.sensitivity) || {};
  const chars = (characters || []).filter((c) => c && c.ideas);
  const charVectors = chars.map((c) => toVector(c.ideas));
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = districts[pickWeighted(districts.map((x) => x.population || 1), rand)];
    const c = cohorts[pickWeighted(cohorts.map((x) => x.share || 1), rand)];
    const sens = sensitivity[`${d.id}:${c.id}`] || {};
    // Sensitivity ~0.6..1.4 around 1: above 1 means this group cares more.
    const base = TRAITS.map((t) => (Number.isFinite(sens[t]) ? (sens[t] - 1) * 1.2 : 0));
    const leanIdx = chars.length ? Math.floor(rand() * chars.length) : -1;
    const lean = leanIdx >= 0 ? charVectors[leanIdx] : TRAITS.map(() => 0);
    const ideas = TRAITS.map((_, k) => Math.round(clamp(base[k] + LEAN * lean[k] + NOISE * gaussian(rand)) * 100) / 100);
    out.push({ id: i + 1, district: d.id, cohort: c.id, lean: leanIdx >= 0 ? chars[leanIdx].id : null, ideas });
  }
  return out;
}

/**
 * How the citizens receive a policy with effect vector `effects`.
 * @returns {{ approve: number, total: number, share: number, byDistrict: object, byLean: object }}
 */
function approval(citizens, effects) {
  const e = toVector(effects);
  const byDistrict = {};
  const byLean = {};
  let approve = 0;
  for (const c of citizens || []) {
    const yes = cosine(c.ideas, e) > APPROVAL_THRESHOLD;
    if (yes) approve++;
    const d = (byDistrict[c.district] = byDistrict[c.district] || { approve: 0, total: 0 });
    d.total++; if (yes) d.approve++;
    if (c.lean) {
      const l = (byLean[c.lean] = byLean[c.lean] || { approve: 0, total: 0 });
      l.total++; if (yes) l.approve++;
    }
  }
  const total = (citizens || []).length;
  return { approve, total, share: total ? approve / total : 0, byDistrict, byLean };
}

module.exports = { TRAITS, CITIZEN_COUNT, APPROVAL_THRESHOLD, generateCitizens, approval, cosine, toVector, prng };
