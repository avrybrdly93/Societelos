'use strict';

// TASK-619: process-level safety nets in server/server.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');

const { installSafetyNets } = require('../server');

test('installSafetyNets logs uncaught exceptions and unhandled rejections without exiting', () => {
  const proc = new EventEmitter();
  const lines = [];
  const uninstall = installSafetyNets(proc, (line) => lines.push(line));
  proc.emit('uncaughtException', new Error('boom in a timer'));
  proc.emit('unhandledRejection', new Error('Gemini socket hang up'));
  proc.emit('unhandledRejection', 'plain string reason');
  assert.deepEqual(uninstall.counts, { uncaughtException: 1, unhandledRejection: 2 });
  assert.match(lines[0], /uncaughtException #1 \(game kept running\): Error: boom in a timer/);
  assert.match(lines[1], /unhandledRejection #1 .*Gemini socket hang up/);
  assert.match(lines[2], /unhandledRejection #2 .*plain string reason/);
  uninstall();
  assert.equal(proc.listenerCount('uncaughtException'), 0);
  assert.equal(proc.listenerCount('unhandledRejection'), 0);
});

test('a process with the safety nets survives a thrown error and a rejected promise', { timeout: 15000 }, async () => {
  // Load server.js in a child (not as main, so it does not listen), install
  // the nets, then inject failures from timers.
  const file = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, ['-e', `
    const srv = require(${JSON.stringify(file)});
    srv.installSafetyNets();
    setTimeout(() => { throw new Error('stray timer error'); }, 10);
    setTimeout(() => { Promise.reject(new Error('stray rejection')); }, 20);
    setTimeout(() => { console.log('STILL_ALIVE'); process.exit(0); }, 200);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0, err);
  assert.match(out, /STILL_ALIVE/);
  assert.match(err, /uncaughtException #1 .*stray timer error/);
  assert.match(err, /unhandledRejection #1 .*stray rejection/);
});
