#!/usr/bin/env node
'use strict';

// XSS guard for the live client code: player-written text (names, finale
// policies, citizen messages) must reach the DOM through textContent, so
// public/js may not use any HTML-parsing sink. Comments are ignored.
//   npm run check:xss

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'js');
const SINKS = [
  [/\.innerHTML\b/, 'innerHTML'],
  [/\.outerHTML\b/, 'outerHTML'],
  [/\binsertAdjacentHTML\s*\(/, 'insertAdjacentHTML()'],
  [/\bdocument\.write(ln)?\s*\(/, 'document.write()'],
  [/\bcreateContextualFragment\s*\(/, 'createContextualFragment()'],
  [/\bDOMParser\b/, 'DOMParser'],
  [/\.srcdoc\b/, 'srcdoc'],
  [/\b(eval|Function)\s*\(/, 'eval()/Function()']
];

let bad = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n');
  let inBlock = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) { inBlock = true; line = line.slice(0, open); }
    line = line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
    for (const [re, name] of SINKS) {
      if (re.test(line)) {
        bad++;
        console.error(`public/js/${file}:${i + 1}: ${name}`);
      }
    }
  });
}
if (bad) {
  console.error(`${bad} HTML sink(s) in public/js: render text with textContent / createElement instead.`);
  process.exit(1);
}
console.log('public/js: no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval sinks');
