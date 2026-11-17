// Runtime config for the static frontend. Overwritten at deploy time by
// scripts/write-config.js (Vercel build) from the LOOM_SOCKET_URL env var.
// Empty socketUrl = connect to the same server that served the page
// (local dev on http://localhost:3000, or a single Render/Docker host).
window.LOOM_CONFIG = Object.freeze({ socketUrl: '' });
