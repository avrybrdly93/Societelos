#!/usr/bin/env node
'use strict';

// TASK-791: SHA-256 checksums of the release build, i.e. every tracked file
// the game needs at runtime (server, client, content, package manifests and
// deploy config). Tests, tooling, plans and reports are left out.
//   node scripts/release-checksums.js            print SHA256SUMS to stdout
//   node scripts/release-checksums.js --write    write artifacts/SHA256SUMS-release.txt
//   node scripts/release-checksums.js --verify [file]  re-hash and compare (exit 1 on mismatch)
// The output is `sha256sum -c` compatible.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const OUT = path.join('artifacts', 'SHA256SUMS-release.txt');
const RELEASE = [
  /^server\/(?!test\/|sim\/test\/|index\.js$)[^/].*\.js$/, // live server (no tests, no legacy prototype)
  /^public\/(index|mobile)\.html$/, /^public\/(css|js|vendor|img)\//, /^public\/config\.js$/,
  /^data\/(crises|roles|citizens|sim)\.json$/,
  /^package(-lock)?\.json$/, /^\.env\.example$/, /^(Dockerfile|render\.yaml|vercel\.json)$/
];

function releaseFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((f) => f && RELEASE.some((re) => re.test(f))).sort();
}

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');

function sums() {
  return releaseFiles().map((f) => `${sha256(f)}  ${f}`).join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--verify') {
    const file = path.join(root, args[1] || OUT);
    const bad = [];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}  /.test(l));
    for (const l of lines) {
      const [hash, f] = [l.slice(0, 64), l.slice(66)];
      if (!fs.existsSync(path.join(root, f))) bad.push(`missing ${f}`);
      else if (sha256(f) !== hash) bad.push(`changed ${f}`);
    }
    const extra = releaseFiles().filter((f) => !lines.some((l) => l.slice(66) === f));
    for (const f of extra) bad.push(`not in checksum list: ${f}`);
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
    console.log(`release checksums OK: ${lines.length} files match ${path.relative(root, file)}`);
    return;
  }
  const text = sums();
  if (args[0] === '--write') {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const header = `# Societelos release build checksums (SHA-256), ${text.trim().split('\n').length} files.\n# Generated from commit ${head} plus any uncommitted changes; regenerate on the final release commit with\n# npm run checksums -- --write, verify with npm run checksums -- --verify (or sha256sum -c).\n`;
    fs.writeFileSync(path.join(root, OUT), header + text);
    console.log(`wrote ${OUT}`);
    return;
  }
  process.stdout.write(text);
}

if (require.main === module) main();
module.exports = { releaseFiles, sums, RELEASE };
