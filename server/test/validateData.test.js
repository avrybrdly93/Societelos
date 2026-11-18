'use strict';

// TASK-724: the schema validator (scripts/validate-data.js, npm run
// check:data) passes on the shipped data and fails, naming the problem, on
// each kind of broken content.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../../scripts/validate-data.js');
const DATA = path.join(__dirname, '../../data');

function run(dir) {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, SOCIETELOS_DATA_DIR: dir }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

/** A temp copy of data/ with `mutate(files)` applied to the parsed JSON. */
function brokenCopy(t, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'societelos-data-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {};
  for (const f of fs.readdirSync(DATA).filter((n) => n.endsWith('.json'))) files[f] = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  mutate(files);
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  return dir;
}

const core = (files, id) => files['crises.json'].crises.find((c) => c.id === id);

test('the shipped data passes the schema validator', () => {
  const r = run(DATA);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /14 core crises complete/);
});

const CASES = [
  ['a core crisis missing an intel role', (f) => { delete core(f, 'aa-purpose-drift').intel.ghost; }, /intel missing for ghost/],
  ['a trait outside [-1, 1]', (f) => { core(f, 'ab-the-pods').options.A.effects.trust = 1.4; }, /trait "trust" must be a number in \[-1, 1\]/],
  ['an effect vector missing a trait', (f) => { delete core(f, 'ba-status-wars').options.B.effects.autonomy; }, /trait "autonomy" must be a number/],
  ['an unknown role tag', (f) => { core(f, 'bb-the-unplugged').options.A.roles = ['catalyst']; }, /unknown role tag "catalyst"/],
  ['a world finale that is not a write-in', (f) => { core(f, 'aa-fake-struggle').mode = 'binary'; }, /missing writein finale for world AA/],
  ['a fixed crisis that is not binary', (f) => { core(f, 'fixed-1-ownership').mode = 'writein'; }, /fixed crises must be binary/],
  ['an option that hurts nobody', (f) => { const e = core(f, 'aa-lost-knowledge').options.A.effects; for (const k of Object.keys(e)) e[k] = Math.abs(e[k]); }, /must hurt at least one trait/],
  ['an emoji in a citizen line', (f) => { f['citizens.json'][0].lines.good[0] += ' \u{1F600}'; }, /contains emoji/],
  ['a citizen line over 140 chars', (f) => { f['citizens.json'][1].lines.bad[0] = 'x'.repeat(141); }, /over 140 chars/],
  ['a malformed epilogue', (f) => { f['citizens.json'][2].epilogue = { great: 'Hi there, everyone.' }; }, /epilogue must be/]
];

for (const [label, mutate, expected] of CASES) {
  test(`the validator rejects ${label}`, (t) => {
    const r = run(brokenCopy(t, mutate));
    assert.equal(r.code, 1, `${label}: validator passed\n${r.out}`);
    assert.match(r.out, expected);
  });
}
