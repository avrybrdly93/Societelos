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
