#!/usr/bin/env node
'use strict';

// TASK-776: no unresolved merge-conflict markers in any tracked text file.
//   node scripts/check-conflicts.js [ref]   (default: the working tree)
// A ref (e.g. origin/main) checks that commit's tree instead.

const { execFileSync } = require('child_process');

const ref = process.argv[2];
const args = ['grep', '-n', '-I', '-E', '^(<<<<<<<|>>>>>>>)( |$)|^=======$'];
if (ref) args.push(ref);
args.push('--', '.');
let out = '';
try {
  out = execFileSync('git', args, { encoding: 'utf8' });
} catch (e) {
  if (e.status !== 1) { console.error(e.message); process.exit(2); } // 1 = no match
}
const hits = out.split('\n').filter(Boolean);
if (hits.length) {
  console.error(`Merge-conflict markers in ${ref || 'the working tree'}:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`No merge-conflict markers in ${ref || 'the working tree'}`);
