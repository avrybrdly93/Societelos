'use strict';

// Societelos — Stream 1 (Network & State) server entry point.
// Express app, static assets and HTTP routes. Socket wiring lives in socket.js,
// game state in gameEngine.js.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const gameEngine = require('./gameEngine');
const { initSockets } = require('./socket');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

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
    console.log(`[server] Societelos listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, PORT, PUBLIC_DIR, shutdownHooks, shutdown };
