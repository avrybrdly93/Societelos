'use strict';

// TASK-571: one place that proves every Stream 4 file is valid:
//   - each server/sim/**/*.js and server/loom.js parses (node --check),
//   - data/sim.json is valid JSON and passes the simulation's own validator,
//   - server/sim/ has no Math.random() and no I/O or network calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const SIM_DIR = path.join(ROOT, 'server', 'sim');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

const stream4Files = [...walk(SIM_DIR).filter((f) => f.endsWith('.js')), path.join(ROOT, 'server', 'loom.js')];

test('every Stream 4 JS file passes node --check', () => {
  assert.ok(stream4Files.length >= 8, 'expected the sim modules, tests and loom.js');
  for (const f of stream4Files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }),
      `syntax error in ${path.relative(ROOT, f)}`);
  }
});

test('data/sim.json parses and passes validateSimConfig with no errors', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'data', 'sim.json'), 'utf8');
  const cfg = JSON.parse(raw);
  const { validateSimConfig } = require('../state');
  assert.deepEqual(validateSimConfig(cfg), []);
});

test('server/sim modules (not tests) use no Math.random(), I/O or network', () => {
  const modules = fs.readdirSync(SIM_DIR).filter((f) => f.endsWith('.js'));
  const bad = [];
  for (const f of modules) {
    fs.readFileSync(path.join(SIM_DIR, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      if (/Math\.random\s*\(/.test(code)) bad.push(`${f}:${i + 1} Math.random()`);
      if (/require\(['"](fs|http|https|net|child_process|dgram|dns|tls)['"]\)|\bfetch\s*\(|XMLHttpRequest|readFileSync|writeFileSync/.test(code)) {
        bad.push(`${f}:${i + 1} I/O or network`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('server/loom.js loads without a GEMINI_API_KEY and exports narrate/moderate/moderateOne', () => {
  const loom = require('../../loom');
  for (const fn of ['narrate', 'moderate', 'moderateOne', 'sanitizeModerationResult']) {
    assert.equal(typeof loom[fn], 'function', `loom.${fn} missing`);
  }
});
