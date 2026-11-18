# Post-merge syntax and dependency check on `main` (TASK-754)

Run on `main` @ `f4ca360` (merge of PR #7, `claude/tasks-2026-11-18-0635`), Node v22.23.5, npm 10.9.9, 2026-11-18.

| Step | Result |
| :--- | :--- |
| `npm ci` (clean install from `package-lock.json`) | OK |
| `npm ls --depth=0` | dotenv 18.0.10, express 4.22.3, qrcode 1.5.4, socket.io 4.8.4, socket.io-client 4.8.4, nodemon 3.1.14 (dev); no missing or invalid packages |
| `npm audit --omit=dev` (production deps) | **0 vulnerabilities** |
| `npm audit` (incl. dev deps) | 6 (1 moderate, 5 high), all in `nodemon`'s file-watcher chain (chokidar / picomatch / minimatch); dev-only, not used by `npm start` |
| `npm run check:all` | exit 0: syntax ok (85 files), no conflict markers, data JSON + schema valid, tag table, DOM ids, HTML, CSS, contrast, XSS sinks, frontend refs, offline, sim purity, **330/330 tests pass**, bench `simulate` 30.8 ms (< 50 ms), heap flat, engine smoke test OK |
| `npm run e2e:ui` (headless Chromium) | E2E OK: cycles 1-4 played with a clean console |

The `nodemon` advisories could be cleared with `npm audit fix`, but that changes the lockfile the night before the demo
for a dev-only tool, so it was left alone. Run it after the demo if wanted.
