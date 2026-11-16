#!/usr/bin/env node
'use strict';

// Verifies every DOM id a client script looks up exists in its HTML page.
// Usage: node scripts/check-dom-ids.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');

// script(s) -> page they run on
const PAIRS = [
  { page: 'index.html', scripts: ['js/host.js', 'js/map.js', 'js/charts.js'] },
  { page: 'mobile.html', scripts: ['js/mobile.js'] }
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
process.exit(failed ? 1 : 0);
