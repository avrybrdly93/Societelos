'use strict';

// Societelos — Stream 1 (Network & State) server entry point.
// Express app, static assets and HTTP routes. Socket wiring lives in socket.js,
// game state in gameEngine.js.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const express = require('express');

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

// Room counter used by /health. The game engine replaces this once it is attached.
app.locals.getActiveRoomCount = () => 0;

// Liveness probe: uptime and number of active game rooms.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    activeRooms: app.locals.getActiveRoomCount()
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] Societelos listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, PORT, PUBLIC_DIR };
