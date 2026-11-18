# Repository file tree audit (TASK-775)

Run on branch `claude/tasks-2026-11-18-0635` with `node scripts/audit-file-tree.js`, which sorts every tracked file by the
"May Modify" columns of `AGENT_INSTRUCTIONS.md` section 1, plus four shared areas that no stream owns but every stream
uses (plan/spec/teacher docs, `scripts/` verification tooling, `artifacts/` reports, deploy config).

| Area | Files |
| :--- | ---: |
| Stream 1: Network & State | 41 |
| Stream 2: Host & Mobile UI | 7 |
| Stream 3: Content & Lore | 4 |
| Stream 4: Simulation & Loom AI | 16 |
| Plan, spec & teacher docs | 10 |
| Verification tooling (`scripts/`) | 24 |
| Archived reports (`artifacts/`) | 13 |
| Deploy config | 4 |
| **Outside every boundary** | **20** |
| Total tracked | 139 |

## Files outside every stream boundary

None of these is a stray edit by one stream into another's territory. They fall into four groups:

**Added by the repo owner (uploads and deployment work), not by a stream agent**

| File | Added in | Used by the game? |
| :--- | :--- | :--- |
| `public/img/*.png` (10 images + `.gitkeep`) | "Added Artwork", projector backdrop work | Yes: projector backdrops and art |
| `public/config.js` | "Host The Loom at avesstudios.com/the-loom" (#4) | Yes: written by `scripts/write-config.js` at Vercel build time |
| `public/vendor/socket.io.min.js` | same (#4) | Yes: the static frontend's Socket.IO client |
| `public/council_of_the_loom.html`, `public/the_loom_cinematic_landing_page.html` | "Add files via upload" | No game code references them (stand-alone pages) |
| `data/sdt_policy_data_collection.json` | "Add files via upload" | No: not read by the server or the validators |
| `public/player.html`, `server/index.js` | Initial commit (prototype) | Only `npm run start:legacy` |

**Created by a stream but not listed in its column**

| File | Created by | Note |
| :--- | :--- | :--- |
| `server/finale.js` | Stream 1, TASK-451 (Borda / 50-25-25 arithmetic moved out of `gameEngine.js`) | Logically Stream 1; the table predates it |
| `public/legacy-host.html` | Stream 2, TASK-056 (old host kept when `index.html` was rebuilt) | Not linked from the game |

## Findings

1. No stream modified another stream's files: every out-of-boundary file was either uploaded by the repo owner or is a
   module a stream split out of its own file (`server/finale.js`).
2. Suggested table update (needs the owner's sign-off, so not changed here): add `server/finale.js` to Stream 1,
   `public/img/**`, `public/vendor/**` and `public/config.js` to Stream 2, and `docs/**`, `scripts/**` and `artifacts/**`
   as shared areas.
3. Candidates to delete or move after the demo (owner decision): `public/legacy-host.html`, `public/player.html` and
   `server/index.js` (legacy prototype), the two stand-alone HTML pages and `data/sdt_policy_data_collection.json` if they
   are not part of the demo.
