'use strict';

// Deterministic randomness for the simulation. Nothing in server/sim may use
// Math.random(): every run is reproducible from its seed.

/**
 * mulberry32: fast 32-bit seeded PRNG.
 * @param {number} seed 32-bit integer seed
 * @returns {() => number} function returning floats in [0, 1)
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a hash of a string (or anything String() can convert) to a 32-bit seed.
 * hashSeed('game:3') always returns the same number.
 */
function hashSeed(str) {
  const input = String(str);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

module.exports = { mulberry32, hashSeed };
