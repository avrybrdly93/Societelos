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
