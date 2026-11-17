'use strict';

// Server start-up: the teacher-facing banner and a clean launch.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const { getLanIp, getJoinUrl } = require('../server');

const SERVER = path.join(__dirname, '..', 'server.js');

/** Start server.js as the main module; resolve with its output once the banner is printed. */
function launch(env = {}, waitFor = /Phones join at/) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const done = (fn) => { clearTimeout(timer); child.kill('SIGTERM'); child.once('exit', (code) => fn({ out, err, code })); };
    const timer = setTimeout(() => done(() => reject(new Error(`no banner: ${out} ${err}`))), 8000);
    child.stdout.on('data', (d) => { out += d; if (waitFor.test(out)) done(resolve); });
    child.stderr.on('data', (d) => { err += d; });
  });
}

// TASK-628 ------------------------------------------------------------------

test('getLanIp prefers the classroom LAN (192.168/10/172.16-31) over virtual and link-local adapters', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    docker0: [{ family: 'IPv4', address: '172.17.0.1', internal: false }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '169.254.10.2', internal: false }],
    utun3: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }]
  };
  assert.equal(getLanIp(ifaces), '192.168.1.20');
  assert.equal(getLanIp({ wlan0: [{ family: 4, address: '10.0.0.7', internal: false }] }), '10.0.0.7', 'Node 18 numeric family');
  assert.equal(getLanIp({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }), 'localhost', 'no network: localhost');
});

test('getJoinUrl is the exact phone address: http://<lan-ip>:<port>/mobile', () => {
  assert.match(getJoinUrl(3000), /^http:\/\/(\d{1,3}(\.\d{1,3}){3}|localhost):3000\/mobile$/);
});

test('the start-up banner prints the local URL and the exact LAN /mobile URL for the teacher', { timeout: 15000 }, async () => {
  const { out } = await launch({ PORT: '0' });
  const listen = out.match(/listening on http:\/\/localhost:(\d+)/);
  assert.ok(listen, out);
  const join = out.match(/Phones join at (http:\/\/\S+)/);
  assert.ok(join, out);
  assert.match(join[1], new RegExp(`^http://(\\d{1,3}(\\.\\d{1,3}){3}|localhost):${listen[1]}/mobile$`));
  assert.equal(join[1], `http://${getLanIp()}:${listen[1]}/mobile`, 'same address the QR code encodes');
});

// TASK-629 ------------------------------------------------------------------

test('Node start-up prints no warnings or deprecations (even with --pending-deprecation)', { timeout: 15000 }, async () => {
  const { out, err } = await launch({ PORT: '0', NODE_OPTIONS: '--pending-deprecation --trace-warnings' });
  assert.equal(err, '', `stderr must be empty, got: ${err}`);
  assert.doesNotMatch(out, /warning|deprecat|\[dotenv/i, out);
  // Only the banner (and the shutdown line from stopping the test server).
  const lines = out.trim().split('\n').filter((l) => !/SIGTERM received/.test(l));
  assert.equal(lines.length, 2, out);
  assert.match(lines[0], /^\[server\] Societelos listening on http:\/\/localhost:\d+$/);
  assert.match(lines[1], /^\[server\] Phones join at http:\/\/\S+\/mobile$/);
});
