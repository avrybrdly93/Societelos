# TASK-743 — Immediate network failure and timeout checks

**Date:** 2026-11-21  
**Verification:** `node --test server/test/loom.test.js` — 31 passed, 0 failed.

Added a focused regression test around the narration transport:

- An injected immediate `fetch failed` rejection is attempted once, returns
  authored fallback output, and completes in under 100 ms (measured under 1 ms
  in this run).
- A simulated hanging request remains pending at 7,999 ms, is aborted at
  8,000 ms, and then returns fallback output.

The test uses mocked fetch behavior; it does not disconnect the laptop from a
live network.
