#!/usr/bin/env node
'use strict';

// TASK-701 / TASK-729: Role Tag Balance Pass over the 28 authored policy
// options a game can reach in data/crises.json:
//   2 fixed crises (Cycles 1-2) x 2 options        =  4
//   4 worlds x 2 binary crises (Cycles 3-4) x 2    = 16
//   4 world finale fallbacks (Cycle 5) x 2         =  8
// Crisis 2B's tags depend on Cycle 1 (rolesByWorld A/B); both variants count.
// The Catalyst scores on GDW swing, never on tags, so it is not counted.
// Spare binary crises authored for cycles > 5 are never reached and are
// excluded. Prints a per-scope tag matrix; exits 1 if any world is unbalanced.
// Usage: node scripts/tag-balance.js [--json]

const path = require('path');

const TAG_ROLES = ['artisan', 'lotus', 'assimilator', 'ghost'];
const WORLDS = ['AA', 'AB', 'BA', 'BB'];

/** [{ id, key, variant, tags }] for every reachable option in one scope. */
function scopeOptions(data, scope) {
  const crises = data.crises;
  let list;
  if (scope === 'fixed') {
    list = crises.filter((c) => c.world === 'fixed' && (c.cycle === 1 || c.cycle === 2));
  } else {
    const finaleId = data.worlds[scope].finale;
    list = crises.filter((c) => c.world === scope && c.mode === 'binary' && (c.cycle === 3 || c.cycle === 4));
    list.push(crises.find((c) => c.id === finaleId));
  }
  const out = [];
  for (const c of list) {
    for (const key of ['A', 'B']) {
      const o = c.options[key];
      if (Array.isArray(o.roles)) out.push({ id: c.id, cycle: c.cycle, key, tags: o.roles });
      else for (const [variant, tags] of Object.entries(o.rolesByWorld || {})) out.push({ id: c.id, cycle: c.cycle, key, variant, tags });
    }
  }
  return out;
}

function count(options) {
  const counts = Object.fromEntries(TAG_ROLES.map((r) => [r, 0]));
  for (const o of options) for (const t of o.tags) if (t in counts) counts[t]++;
  return counts;
}

function balanceReport(data) {
  const scopes = {};
  for (const scope of ['fixed', ...WORLDS]) {
    const options = scopeOptions(data, scope);
    scopes[scope] = { options, counts: count(options) };
  }
  const all = Object.values(scopes).flatMap((s) => s.options);
  const optionCount = new Set(all.map((o) => `${o.id}:${o.key}`)).size;
  // Fixed-path view: each Cycle 1 result fixes which Crisis 2B variant applies.
  const paths = {};
  for (const v of ['A', 'B']) {
    paths[v] = count(scopes.fixed.options.filter((o) => !o.variant || o.variant === v));
  }
  return { scopes, global: count(all), optionCount, paths };
}

const isEven = (counts) => new Set(Object.values(counts)).size === 1;

if (require.main === module) {
  const data = require(path.join(__dirname, '..', 'data', 'crises.json'));
  const report = balanceReport(data);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ global: report.global, optionCount: report.optionCount, paths: report.paths, scopes: Object.fromEntries(Object.entries(report.scopes).map(([k, s]) => [k, s.counts])) }, null, 2));
    process.exit(0);
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`Role tag balance over ${report.optionCount} authored options (Crisis 2B counted per world variant)\n`);
  console.log(pad('scope', 18) + TAG_ROLES.map((r) => pad(r, 13)).join('') + 'balanced');
  const row = (label, counts) => console.log(pad(label, 18) + TAG_ROLES.map((r) => pad(counts[r], 13)).join('') + (isEven(counts) ? 'yes' : 'NO'));
  row('fixed (C1-2)', report.scopes.fixed.counts);
  row('  path 1A -> 2B/A', report.paths.A);
  row('  path 1B -> 2B/B', report.paths.B);
  for (const w of WORLDS) row(`world ${w} (C3-5)`, report.scopes[w].counts);
  row('global', report.global);
  console.log('\nPer option:');
  for (const [scope, s] of Object.entries(report.scopes)) {
    for (const o of s.options) console.log(`  ${pad(scope, 6)} C${o.cycle} ${pad(o.id, 22)} ${o.key}${o.variant ? `/${o.variant}` : '  '} ${o.tags.join(', ') || '(none)'}`);
  }
  const unbalanced = WORLDS.filter((w) => !isEven(report.scopes[w].counts));
  if (unbalanced.length) {
    console.error(`\nUnbalanced worlds: ${unbalanced.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll 4 worlds balanced.');
}

module.exports = { balanceReport, scopeOptions, TAG_ROLES, WORLDS, isEven };
