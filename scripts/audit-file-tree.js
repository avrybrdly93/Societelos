#!/usr/bin/env node
'use strict';

// TASK-775: audit the tracked file tree against the 4 workstreams' file
// boundaries (AGENT_INSTRUCTIONS.md section 1). Every tracked file is put in
// the stream that may modify it, in a shared tooling/docs area, or flagged
// as unowned. Prints a table and the unowned list; --json for machine output.
//   node scripts/audit-file-tree.js           exit 0 (report only)
//   node scripts/audit-file-tree.js --strict  exit 1 if any file is unowned

const { execFileSync } = require('child_process');

// "May Modify" columns of AGENT_INSTRUCTIONS.md, as path patterns.
const STREAMS = [
  ['Stream 1: Network & State', [/^server\/(server|socket|gameEngine)\.js$/, /^server\/test\//, /^package(-lock)?\.json$/, /^\.env\.example$/, /^readme\.md$/i, /^AGENT_INSTRUCTIONS\.md$/]],
  ['Stream 2: Host & Mobile UI', [/^public\/(index|mobile)\.html$/, /^public\/css\//, /^public\/js\//]],
  ['Stream 3: Content & Lore', [/^data\/(crises|roles|citizens)\.json$/, /^data\/SCHEMA\.md$/]],
  ['Stream 4: Simulation & Loom AI', [/^server\/sim\//, /^server\/loom\.js$/, /^data\/sim\.json$/]]
];
// Not in any stream's column, but expected project-wide files: plan and spec
// documents, verification tooling, archived reports, deploy configuration.
const SHARED = [
  ['Plan, spec & teacher docs', [/^(task_list|mvp_spec|project_context|rules|kickoff_prompt|Scheduled_Prompt)\.md$/, /\.pdf$/, /^docs\//]],
  ['Verification tooling (scripts/)', [/^scripts\//]],
  ['Archived reports (artifacts/)', [/^artifacts\//]],
  ['Deploy config', [/^(Dockerfile|render\.yaml|vercel\.json|\.gitignore|\.dockerignore|\.nvmrc|\.node-version)$/]]
];

function classify(file) {
  for (const [name, pats] of STREAMS) if (pats.some((re) => re.test(file))) return { group: name, owned: true };
  for (const [name, pats] of SHARED) if (pats.some((re) => re.test(file))) return { group: name, owned: true, shared: true };
  return { group: 'UNOWNED', owned: false };
}

function audit(files) {
  const groups = {};
  for (const f of files) {
    const c = classify(f);
    (groups[c.group] = groups[c.group] || []).push(f);
  }
  return { total: files.length, groups, unowned: groups.UNOWNED || [] };
}

function main() {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const r = audit(files);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`Tracked files: ${r.total}`);
  for (const [name] of [...STREAMS, ...SHARED, ['UNOWNED']]) {
    const list = r.groups[name] || [];
    console.log(`  ${name.padEnd(34)} ${String(list.length).padStart(4)}`);
  }
  if (r.unowned.length) {
    console.log('\nOutside every stream boundary and the shared areas:');
    for (const f of r.unowned) console.log(`  ${f}`);
  }
  if (process.argv.includes('--strict') && r.unowned.length) process.exit(1);
}

if (require.main === module) main();
module.exports = { classify, audit, STREAMS, SHARED };
