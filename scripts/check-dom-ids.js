#!/usr/bin/env node
'use strict';

// Verifies every DOM id a client script looks up exists in its HTML page.
// Usage: node scripts/check-dom-ids.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');

// script(s) -> page they run on
const PAIRS = [
  { page: 'index.html', scripts: ['js/host.js', 'js/charts.js', 'js/cinematic.js', 'js/council.js', 'js/mathbold.js'] },
  { page: 'mobile.html', scripts: ['js/mobile.js', 'js/mathbold.js'] }
];

function idsInHtml(html) {
  return new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));
}

function idsReferenced(js) {
  const ids = new Set();
  for (const m of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
  // querySelector('#id ...') lookups
  for (const m of js.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z][\w-]*)/g)) ids.add(m[1]);
  return ids;
}

let failed = false;
for (const { page, scripts } of PAIRS) {
  const html = idsInHtml(fs.readFileSync(path.join(ROOT, page), 'utf8'));
  for (const script of scripts) {
    const missing = [...idsReferenced(fs.readFileSync(path.join(ROOT, script), 'utf8'))].filter((id) => !html.has(id));
    if (missing.length) {
      failed = true;
      console.error(`${script}: ids missing from ${page}: ${missing.join(', ')}`);
    } else {
      console.log(`${script}: all ids found in ${page}`);
    }
  }
}
// Script load order: each page must load its helpers before the controller
// that uses them (host.js reads window.SocietelosMap and SocietelosCharts).
const ORDER = [
  { page: 'index.html', scripts: ['/vendor/socket.io.min.js', '/js/charts.js', '/js/council.js', '/js/host.js'] },
  { page: 'mobile.html', scripts: ['/vendor/socket.io.min.js', '/js/mobile.js'] }
];
for (const { page, scripts } of ORDER) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const srcs = Array.from(html.matchAll(/<script\s+src="([^"]+)"/g), (m) => m[1].replace(/^(?!\/)/, '/'));
  const positions = scripts.map((s) => srcs.indexOf(s));
  const ok = positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
  if (ok) console.log(`${page}: scripts load in order (${scripts.join(' -> ')})`);
  else {
    failed = true;
    console.error(`${page}: expected script order ${scripts.join(' -> ')}, found ${srcs.join(', ')}`);
  }
}


// Duplicate ids: getElementById would silently pick the first one.
for (const { page } of PAIRS) {
  const all = Array.from(fs.readFileSync(path.join(ROOT, page), 'utf8').matchAll(/\sid="([^"]+)"/g), (m) => m[1]);
  const dupes = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
  if (dupes.length) {
    failed = true;
    console.error(`${page}: duplicate ids: ${dupes.join(', ')}`);
  } else console.log(`${page}: no duplicate ids`);
}

// Class selectors a script queries must exist in its page's markup or be
// created by the script itself (className / classList.add).
for (const { page, scripts } of PAIRS) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const inHtml = new Set(Array.from(html.matchAll(/\sclass="([^"]+)"/g), (m) => m[1].split(/\s+/)).flat());
  for (const script of scripts) {
    const js = fs.readFileSync(path.join(ROOT, script), 'utf8');
    const made = new Set();
    for (const m of js.matchAll(/(?:className\s*=\s*|setAttribute\(\s*['"]class['"]\s*,\s*)[`'"]([^`'"]+)[`'"]/g)) m[1].split(/\s+/).forEach((c) => made.add(c.replace(/\$\{[^}]*\}/g, '')));
    for (const m of js.matchAll(/classList\.(?:add|toggle)\(\s*['"]([\w-]+)['"]/g)) made.add(m[1]);
    const queried = new Set(Array.from(js.matchAll(/querySelector(?:All)?\(\s*[`'"][^`'"]*?\.([A-Za-z][\w-]*)/g), (m) => m[1]));
    const missing = [...queried].filter((c) => !inHtml.has(c) && !made.has(c));
    if (missing.length) {
      failed = true;
      console.error(`${script}: classes queried but never in ${page} or created: ${missing.join(', ')}`);
    } else console.log(`${script}: all queried classes exist`);
  }
}

// Cycle 5 contract: every finale screen and control the clients drive.
const CYCLE5 = {
  'index.html': [
    'finale-callout', 'finale-progress', 'finale-progress-count', 'finale-status', 'finale-status-text', 'finale-status-sub',
    'view-finale', 'finale-title', 'finale-instruction', 'proposal-cards', 'finale-clock', 'rank-progress', 'rank-progress-count',
    'view-enact', 'enact-wait', 'enact-cards', 'borda-bars', 'resolution-enacted', 'finale-fallback-notice',
    'forecast-chart', 'region-map', 'map-month', 'citizen-feed', 'cycle-indicator', 'btn-fullscreen'
  ],
  'mobile.html': [
    'm-view-finale-write', 'finale-goal', 'finale-goal-text', 'finale-form', 'finale-text', 'finale-count', 'finale-submit', 'finale-error',
    'm-view-finale-wait', 'finale-wait-title', 'finale-wait-mine', 'finale-wait-status',
    'finale-revise', 'finale-feedback', 'finale-revise-form', 'finale-revise-text', 'finale-revise-submit', 'finale-revise-error',
    'm-view-finale-rank', 'rank-help', 'rank-cards', 'rank-submit', 'rank-error', 'rank-locked', 'm-finale-fallback'
  ]
};
for (const [page, ids] of Object.entries(CYCLE5)) {
  const html = idsInHtml(fs.readFileSync(path.join(ROOT, page), 'utf8'));
  const missing = ids.filter((id) => !html.has(id));
  if (missing.length) {
    failed = true;
    console.error(`${page}: Cycle 5 elements missing: ${missing.join(', ')}`);
  } else console.log(`${page}: all ${ids.length} Cycle 5 elements present`);
}
const timers = (fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8').match(/class="finale-timer"/g) || []).length;
if (timers !== 2) { failed = true; console.error(`mobile.html: expected 2 finale timer bars (write, resubmit), found ${timers}`); }

process.exit(failed ? 1 : 0);
