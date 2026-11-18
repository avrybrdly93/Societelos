'use strict';

// TASK-651: secrets and dependencies never get committed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

test('.gitignore excludes node_modules/ and .env (and local .env variants, but not .env.example)', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('node_modules/'), 'node_modules/');
  assert.ok(lines.includes('.env'), '.env');
  assert.ok(lines.includes('.env.*') && lines.includes('!.env.example'), '.env.* ignored, .env.example kept');
  assert.ok(fs.existsSync(path.join(ROOT, '.env.example')), '.env.example documents the variables');
});

test('no .env file or node_modules is tracked by git', (t) => {
  let files;
  try {
    files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  } catch {
    t.skip('git not available');
    return;
  }
  assert.deepEqual(files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')), []);
  assert.deepEqual(files.filter((f) => f.startsWith('node_modules/')), []);
  // And no Gemini key pattern in tracked text files.
  const keyLike = /AIza[0-9A-Za-z_-]{35}/;
  const leaks = files.filter((f) => f && /\.(js|json|md|txt|html|css|example)$/.test(f))
    .filter((f) => { try { return keyLike.test(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return false; } });
  assert.deepEqual(leaks, [], 'no Google API key committed');
});

// TASK-777: no TODO / FIXME stubs left in production code.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const PRODUCTION = () => [
  ...walk(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js') && !/[\\/]test[\\/]/.test(f) && !f.endsWith(path.join('server', 'index.js'))),
  ...walk(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js')),
  ...['index.html', 'mobile.html', 'css/styles.css'].map((f) => path.join(ROOT, 'public', f)),
  ...walk(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.js')),
  ...walk(path.join(ROOT, 'data')).filter((f) => f.endsWith('.json'))
];

test('TASK-777: no TODO, FIXME, XXX or HACK markers in production code', () => {
  const hits = [];
  for (const f of PRODUCTION()) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

// TASK-778: no Math.random() in the simulation or anywhere in the live game
// server (role assignment, crisis selection, seat order, tie-breaks all use
// seeded hashes of the game id, so a game replays from its seed). Only the
// legacy pre-hackathon prototype (server/index.js, npm run start:legacy) is exempt.
test('TASK-778: no Math.random() in server/sim or the live game server', () => {
  const files = walk(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js') && !/[\\/]test[\\/]/.test(f) && !f.endsWith(path.join('server', 'index.js')));
  assert.ok(files.some((f) => f.endsWith('gameEngine.js')) && files.some((f) => /[\\/]sim[\\/]/.test(f)));
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (/Math\.random\s*\(/.test(code)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
