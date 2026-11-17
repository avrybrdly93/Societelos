# Backend code audit (Thursday, Tasks 641–643)

Line counts and comment review of the Stream 1 server files. Counts are
physical lines; "comment lines" are lines that are only a comment.

## server/gameEngine.js (TASK-641)

| | |
| :--- | ---: |
| Lines | 2,397 |
| Comment lines | 547 (~23%) |
| GameState methods | 97 |

Findings and changes:
- The file is long because GameState holds every phase of the game; it is
  split by concern inside the class rather than across files. Added a
  **map of the file** at the top (constants, pure helpers, timers, phase
  flow, voting, finale, scoring, end screen, reconnects, teacher controls,
  room registry) so a reader can jump by name.
- Fixed a stale doc comment: `startResolutionPhase` said the simulation was
  a "stub until server/sim is merged"; it has used the real seeded
  `server/sim` since Tuesday.
- Removed dead code: `loomStub.moderate` was never called (a failed
  `loom.moderate` falls back to the authored A/B finale, not to a stub).
  The narration stub stays as the last-resort fallback.
- Every public method has a JSDoc comment stating its contract; phase
  starters name their phase and duration.
- Small unused helpers kept on purpose (cheap, part of the class API):
  `timeRemainingMs()`, `findNodeBySocket()`.
- Finale arithmetic (Borda, 50/25/25, package vector) already lives in
  `server/finale.js` (pure functions); no further split is needed for the MVP.

## server/socket.js (TASK-642)

| | |
| :--- | ---: |
| Lines | 641 |
| Comment lines | 119 (~19%) |
| Inbound events (all through `onValid`) | 14 |

Findings and changes:
- Every inbound client event goes through `onValid()` (rate limit, payload
  schema, try/catch), so a bad packet cannot crash the server. The only raw
  listener is `disconnect`.
- Added an **event index** at the top of the file: client types and every
  event by direction (host → server, phone → server, server → room,
  server → one phone, server → host).
- Updated stale comments: `detectClientType` now documents the
  `spectator` client type; `roomChannel` / `hostChannel` explain who is in
  each Socket.IO room (`hostChannel` is joined by the projector and kept for
  host-only broadcasts; none are needed for the MVP).
- Private events (`role:assigned`, `intel:drop`, `override:status`,
  `score:update`, `finale:feedback`, `finale:ballot`, `state:sync`) are only
  ever sent with `emitToNode` / to one socket; covered by
  `server/test/specContract.test.js` and `server/test/reconnect.test.js`.
- No dead code found.

## server/server.js (TASK-643)

| | |
| :--- | ---: |
| Lines | 189 |
| Comment lines | 40 (~21%) |

Findings and changes:
- Small and single-purpose. Added a **route list** to the file header
  (`/`, `/host`, `/mobile`, `/health`, `/api/qr`, `/api/state`, static
  `/public`) and what happens when it runs as main.
- Every block already carries a comment: LAN IP choice, static caching
  (no-cache + ETag), page fallback (`mobile.html` before the legacy
  `player.html`), debug endpoint gating, QR route, Socket.IO heartbeat and
  CORS, graceful shutdown, crash safety nets, port-clash exit.
- `require('dotenv').config({ quiet: true })` keeps start-up output to the
  two banner lines (no dotenv tips), checked by `server/test/startup.test.js`.
- No dead code found.
