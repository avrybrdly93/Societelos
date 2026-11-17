'use strict';

// Societelos — Stream 1 (Network & State) server entry point.
// Express app, static assets and HTTP routes. Socket wiring lives in socket.js,
// game state in gameEngine.js.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const gameEngine = require('./gameEngine');
const { initSockets } = require('./socket');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

/**
 * Best LAN IPv4 address for phones to reach this laptop (classroom Wi-Fi or a
 * phone hotspot). Prefers private ranges (192.168/10/172.16-31) and skips
 * internal, link-local and virtual-adapter addresses. Falls back to localhost.
 */
function getLanIp(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      const v4 = addr.family === 'IPv4' || addr.family === 4;
      if (!v4 || addr.internal || addr.address.startsWith('169.254.')) continue;
      const virtual = /^(docker|br-|veth|vbox|vmnet|utun|tun|tap|zt|tailscale|wg)/i.test(name);
      const isPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr.address);
      candidates.push({ address: addr.address, score: (isPrivate ? 2 : 0) + (virtual ? 0 : 1) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].address : 'localhost';
}

/** The URL phones should open, e.g. http://192.168.1.20:3000/mobile */
function getJoinUrl(port = PORT) {
  return `http://${getLanIp()}:${port}/mobile`;
}

// Serve /public static assets (host screen, mobile controller, css, js).
// Cache-Control: no-cache + ETag: browsers keep a copy but revalidate on
// every load, so a reload during a demo is instant (304, no body) and an
// edited file is picked up at once, never a stale cached version.
const STATIC_CACHE_CONTROL = 'no-cache';
const noCache = (res) => res.setHeader('Cache-Control', STATIC_CACHE_CONTROL);
app.use(express.static(PUBLIC_DIR, { etag: true, lastModified: true, setHeaders: noCache }));

// Send the first page in `candidates` that exists in /public.
// Lets new pages (mobile.html) replace legacy ones (player.html) without breaking routes.
function sendPublicPage(res, candidates) {
  const file = candidates.map((name) => path.join(PUBLIC_DIR, name)).find((p) => fs.existsSync(p));
  if (!file) return res.status(404).send('Page not found');
  return res.sendFile(file, { headers: { 'Cache-Control': STATIC_CACHE_CONTROL } });
}

// Mobile controller for the 5 phones.
app.get('/mobile', (req, res) => sendPublicPage(res, ['mobile.html', 'player.html']));

// Host projector screen.
app.get(['/', '/host'], (req, res) => sendPublicPage(res, ['index.html']));

// Room counter used by /health.
app.locals.getActiveRoomCount = () => gameEngine.rooms.size;

// Liveness probe: uptime and number of active game rooms.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    activeRooms: app.locals.getActiveRoomCount()
  });
});

// Debug: non-secret state of every room for integration testing.
// Disabled when NODE_ENV=production (responds 404, like any unknown route).
app.get('/api/state', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') return next();
  const rooms = Array.from(gameEngine.rooms.values()).map((game) => game.debugState());
  return res.json({ rooms });
});

// QR code (PNG data URL) pointing phones at http://<lan-ip>:<port>/mobile.
app.get('/api/qr', async (req, res) => {
  try {
    const port = (server.address() && server.address().port) || PORT;
    const joinUrl = getJoinUrl(port);
    const dataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 });
    res.json({ joinUrl, dataUrl });
  } catch (err) {
    console.error('[server] QR generation failed', err);
    res.status(500).json({ error: 'QR_FAILED' });
  }
});

// HTTP server wrapper with Socket.IO attached. Sockets are wired in socket.js.
const server = http.createServer(app);
// Classroom Wi-Fi settings: a heartbeat every 5 s, and a phone counts as gone
// only after 20 s of silence, so a brief Wi-Fi blip or a phone switching
// access points does not drop the seat. CORS is open because phones load the
// pages from this same LAN server (there is no other origin to protect).
const SOCKET_OPTIONS = Object.freeze({
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout: 20000
});
const io = new Server(server, { ...SOCKET_OPTIONS, cors: { ...SOCKET_OPTIONS.cors } }); // a copy: Socket.IO adds its own defaults
initSockets(io, gameEngine);

// Graceful shutdown: hooks (e.g. clearing game timers) run first, then sockets
// and the HTTP server close. A hard exit after 3 s guards against hung sockets.
const shutdownHooks = [() => {
  for (const code of Array.from(gameEngine.rooms.keys())) gameEngine.closeRoom(code);
}];
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down`);
  for (const hook of shutdownHooks) {
    try { hook(); } catch (err) { console.error('[server] shutdown hook failed', err); }
  }
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

/**
 * Classroom safety nets: a stray exception or rejected promise is logged
 * (with a running count) instead of killing a live game for 30 students.
 * Returns an uninstall function. Installed only when run as the server.
 */
function installSafetyNets(proc = process, log = console.error) {
  const counts = { uncaughtException: 0, unhandledRejection: 0 };
  const describe = (err) => (err && err.stack) || (err && err.message) || String(err);
  const onException = (err) => {
    counts.uncaughtException++;
    log(`[server] uncaughtException #${counts.uncaughtException} (game kept running): ${describe(err)}`);
  };
  const onRejection = (reason) => {
    counts.unhandledRejection++;
    log(`[server] unhandledRejection #${counts.unhandledRejection} (game kept running): ${describe(reason)}`);
  };
  proc.on('uncaughtException', onException);
  proc.on('unhandledRejection', onRejection);
  const uninstall = () => {
    proc.off('uncaughtException', onException);
    proc.off('unhandledRejection', onRejection);
  };
  uninstall.counts = counts;
  return uninstall;
}

if (require.main === module) {
  installSafetyNets();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // A port clash at start-up is not a classroom-game error: say so and stop.
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${PORT} is already in use. Close the other server or set PORT in .env.`);
      process.exit(1);
    }
    console.error(`[server] HTTP server error: ${err && err.message}`);
  });
  server.listen(PORT, () => {
    const port = server.address().port;
    console.log(`[server] Societelos listening on http://localhost:${port}`);
    console.log(`[server] Phones join at ${getJoinUrl(port)}`);
  });
}

module.exports = { app, server, io, PORT, PUBLIC_DIR, shutdownHooks, shutdown, getLanIp, getJoinUrl, installSafetyNets, SOCKET_OPTIONS };
