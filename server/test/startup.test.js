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

test('getJoinUrl uses PUBLIC_URL for a reverse-proxied subpath deployment', () => {
  assert.equal(getJoinUrl(3000, 'https://avesstudios.com/the-loom'), 'https://avesstudios.com/the-loom/mobile.html');
  assert.equal(getJoinUrl(3000, 'https://avesstudios.com/the-loom/'), 'https://avesstudios.com/the-loom/mobile.html');
  assert.match(getJoinUrl(3000, '  '), /^http:\/\/.+:3000\/mobile$/);
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

// TASK-639 ------------------------------------------------------------------

test('Socket.IO uses classroom Wi-Fi heartbeat settings (pingInterval 5 s, pingTimeout 20 s) and open CORS', () => {
  const { io, SOCKET_OPTIONS } = require('../server');
  assert.equal(SOCKET_OPTIONS.pingInterval, 5000);
  assert.equal(SOCKET_OPTIONS.pingTimeout, 20000);
  assert.equal(io.engine.opts.pingInterval, 5000);
  assert.equal(io.engine.opts.pingTimeout, 20000);
  assert.deepEqual(io.engine.opts.cors, { origin: '*' });
  io.close();
});

// TASK-640 ------------------------------------------------------------------

test('static files and pages revalidate on reload: Cache-Control no-cache, ETag and 304s', { timeout: 15000 }, async () => {
  const { app } = require('../server');
  const http = require('http');
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const route of ['/', '/mobile', '/css/styles.css', '/js/host.js', '/js/mobile.js']) {
      const first = await fetch(base + route);
      assert.equal(first.status, 200, route);
      assert.equal(first.headers.get('cache-control'), 'no-cache', `${route} cache-control`);
      const etag = first.headers.get('etag');
      assert.ok(etag, `${route} has an ETag`);
      await first.arrayBuffer();
      // Raw http.get: fetch() adds Cache-Control: no-cache to conditional
      // requests (Fetch spec), which a browser reload does not.
      const status = await new Promise((resolve, reject) => {
        http.get(base + route, { headers: { 'If-None-Match': etag } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
      });
      assert.equal(status, 304, `${route} reload is a 304`);
    }
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

// TASK-652 ------------------------------------------------------------------

/** Run `npm start`, wait for the banner, probe /health, then stop it. */
function npmStart(env) {
  return new Promise((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['start', '--silent'], { cwd: path.join(__dirname, '..', '..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let out = '';
    let err = '';
    let probed = false; // the shutdown line arrives later: probe only once
    const stop = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } };
    const timer = setTimeout(() => { stop(); reject(new Error(`npm start gave no banner: ${out} ${err}`)); }, 15000);
    child.stdout.on('data', async (d) => {
      out += d;
      const m = out.match(/listening on http:\/\/localhost:(\d+)/);
      if (probed || !m || !/Phones join at/.test(out)) return;
      probed = true;
      clearTimeout(timer);
      try {
        const health = await (await fetch(`http://127.0.0.1:${m[1]}/health`)).json();
        stop();
        child.once('exit', () => resolve({ port: Number(m[1]), health, out, err }));
      } catch (e) { stop(); reject(new Error(`${e.message}: ${e.cause && e.cause.code} ${out}`)); }
    });
    child.stderr.on('data', (d) => { err += d; });
  });
}

const portFree = (port) => new Promise((resolve) => {
  const s = require('net').createServer().once('error', () => resolve(false)).listen(port, () => s.close(() => resolve(true)));
});

test('npm start launches cleanly on process.env.PORT', { timeout: 30000 }, async () => {
  const { port, health, err } = await npmStart({ PORT: '3917' });
  assert.equal(port, 3917);
  assert.equal(health.status, 'ok');
  assert.equal(err, '');
});

test('npm start defaults to port 3000 when PORT is unset', { timeout: 30000 }, async (t) => {
  if (!(await portFree(3000))) { t.skip('port 3000 busy on this machine'); return; }
  const { port, health } = await npmStart({ PORT: '' }); // empty PORT = unset for server.js
  assert.equal(port, 3000);
  assert.equal(health.status, 'ok');
});
