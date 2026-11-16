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
app.use(express.static(PUBLIC_DIR));

// Send the first page in `candidates` that exists in /public.
// Lets new pages (mobile.html) replace legacy ones (player.html) without breaking routes.
function sendPublicPage(res, candidates) {
  const file = candidates.map((name) => path.join(PUBLIC_DIR, name)).find((p) => fs.existsSync(p));
  if (!file) return res.status(404).send('Page not found');
  return res.sendFile(file);
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
const io = new Server(server, { cors: { origin: '*' } });
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

if (require.main === module) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  server.listen(PORT, () => {
    const port = server.address().port;
    console.log(`[server] Societelos listening on http://localhost:${port}`);
    console.log(`[server] Phones join at ${getJoinUrl(port)}`);
  });
}

module.exports = { app, server, io, PORT, PUBLIC_DIR, shutdownHooks, shutdown, getLanIp, getJoinUrl };
