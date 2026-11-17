#!/usr/bin/env node
'use strict';

// Reference check for the browser scripts in public/js (no dependencies):
//  1. every script runs in strict mode inside an IIFE, so a typo'd variable
//     assignment throws instead of creating a global;
//  2. every member of window.SocietelosMap / SocietelosCharts that host.js
//     uses (directly or through a local alias such as `const map = ...`) is
//     actually exported by map.js / charts.js;
//  3. the debug helpers the test scripts drive are exported.
//   npm run check:refs

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'js');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
let failed = false;
const fail = (msg) => { failed = true; console.error(msg); };

// 1. Strict mode inside an IIFE.
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
  const head = read(file).split('\n').slice(0, 8).join('\n');
  if (!/\(function\s*\(\)\s*\{\s*\n\s*'use strict';/.test(head)) fail(`public/js/${file}: expected (function () { 'use strict'; ... })()`);
}

// 2. Cross-module members.
function exportedKeys(file, globalName) {
  const m = read(file).match(new RegExp(`window\\.${globalName}\\s*=\\s*\\{([^}]*)\\}`));
  if (!m) { fail(`public/js/${file}: window.${globalName} export not found`); return new Set(); }
  return new Set(m[1].split(',').map((k) => k.split(':')[0].trim()).filter(Boolean));
}
const MODULES = { SocietelosMap: 'map.js', SocietelosCharts: 'charts.js' };
for (const consumer of ['host.js']) {
  const js = read(consumer);
  for (const [globalName, file] of Object.entries(MODULES)) {
    const keys = exportedKeys(file, globalName);
    const aliases = Array.from(js.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*window\\.${globalName}\\b`, 'g')), (m) => m[1]);
    const used = new Set();
    for (const name of [`window\\.${globalName}`, ...aliases.map((a) => `\\b${a}`)]) {
      for (const m of js.matchAll(new RegExp(`${name}\\.(\\w+)`, 'g'))) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !keys.has(k));
    if (missing.length) fail(`public/js/${consumer}: uses ${globalName}.${missing.join(', .')} not exported by ${file}`);
    else console.log(`${consumer} -> ${file}: ${used.size} members used, all exported`);
  }
}

// 3. Debug helpers driven by scripts/e2e-finale.js and the task list.
const HELPERS = { 'host.js': ['debugTriggerPhase', 'debugTriggerEvent'], 'mobile.js': ['debugMobilePhase', 'debugMobileEvent', 'debugMobileBallot'] };
for (const [file, names] of Object.entries(HELPERS)) {
  const js = read(file);
  const missing = names.filter((n) => !new RegExp(`window\\.${n}\\s*=`).test(js));
  if (missing.length) fail(`public/js/${file}: debug helpers not exported: ${missing.join(', ')}`);
}

if (failed) process.exit(1);
console.log('public/js: strict-mode IIFEs, cross-module references and debug helpers OK');
