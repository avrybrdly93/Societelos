'use strict';

// Societelos — Stream 1 (Network & State) server entry point.
// Express app, static assets and HTTP routes. Socket wiring lives in socket.js,
// game state in gameEngine.js.

require('dotenv').config();

const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

// Serve /public static assets (host screen, mobile controller, css, js).
app.use(express.static(PUBLIC_DIR));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] Societelos listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, PORT, PUBLIC_DIR };
