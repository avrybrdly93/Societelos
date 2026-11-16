# SYSTEM DIRECTIVE: SOCIETELOS MASTER AGENT INSTRUCTIONS

**ATTENTION LLM / AI AGENT:**
You are acting as an AI pair-programmer for **Societelos**, a 5-player classroom post-labor simulation game played locally via WebSockets (Jackbox-style: 1 shared 1080p projector host display + 5 mobile phone controllers).

The project is structured around **4 autonomous workstreams** executing an 800-task roadmap (Monday–Thursday milestones). Your primary directive is to execute scoped tasks **without violating the strict file-modification boundaries of your assigned stream** and ensuring that all automated quality checks pass.

---

## 1. The 4 Workstreams & Strict File Boundaries

Ownership is defined by exact file path. Identify which stream you are assisting and **NEVER** modify files outside its assigned territory. If your implementation depends on functionality from another stream, program against the agreed contract/stub and leave a note.

| Stream | Branch | May Modify | Must NOT Modify |
| :--- | :--- | :--- | :--- |
| **Stream 1: Network & State** | `feature/backend` | `server/server.js`<br>`server/socket.js`<br>`server/gameEngine.js`<br>`server/test/**`<br>`package.json`, `.env.example`<br>`README.md`, `AGENT_INSTRUCTIONS.md` | `public/**`<br>`data/**`<br>`server/sim/**`<br>`server/loom.js` |
| **Stream 2: Host & Mobile UI** | `feature/frontend` | `public/index.html`<br>`public/mobile.html`<br>`public/css/*`<br>`public/js/*` | `server/**`<br>`data/**`<br>`scripts/**` |
| **Stream 3: Content & Lore** | `feature/content` | `data/crises.json`<br>`data/roles.json`<br>`data/citizens.json`<br>`data/SCHEMA.md` | `server/**`<br>`public/**`<br>`data/sim.json` |
| **Stream 4: Simulation & Loom AI** | `feature/sim` | `server/sim/**`<br>`server/loom.js`<br>`server/sim/test/**`<br>`data/sim.json` | `server/server.js`<br>`server/socket.js`<br>`server/gameEngine.js`<br>`public/**`<br>`data/{crises,roles,citizens}.json` |

### Core Stream Rules:
1. **Branch Discipline:** Develop only within your stream's feature branch. Never push broken code to `main`.
2. **Secrets Protection:** Never commit secrets. `GEMINI_API_KEY` lives exclusively in `.env` (refer to `.env.example`).
3. **No Cross-Pollution:** Stream 1 wires into Stream 4 exclusively through `simulate(state, effects, opts)` and `loom.moderate` / `loom.narrate`.
4. **Air-Gap Compliance:** The game must function on an offline classroom Wi-Fi router. **No external CDNs, Google Fonts, or remote asset fetches in `public/`.**

---

## 2. Aesthetic & UI Architecture

* **Design Aesthetic:** Dystopian post-labor administrative interface.
  * Surfaces: Dark slate (`--slate-950: #080b10`, `--slate-900: #0d1117`, `--slate-800: #161c25`, `--slate-700: #222b38`).
  * Text: High-contrast slate tones (`--slate-50: #eef2f6`, `--slate-400: #7d8a9a`).
  * Accents: Loom Cyan (`--loom-cyan: #3fd8e6`), Alert Crimson (`--alert-crimson: #e5484d`), Amber (`#f0a430`), Teal (`#2bc4a0`).
  * System Fonts Only: `--font-sans` (system UI) and `--font-mono` (monospace numbers, codes, timers).
* **Styling Technology:** **Vanilla CSS with CSS Custom Properties** in `public/css/styles.css`. Do **not** inject Tailwind CDN links or external build steps.
* **Host Projector Screen (`public/index.html`):**
  * Tuned for 1920x1080 display (min 24px body text, 48px headers for back-row classroom legibility).
  * Features persistent status topbar: Room Code, Cycle indicator (`CYCLE X/5`), Phase timer (`MM:SS`), and GDW badge.
  * Interactive 5-district SVG map (`D1 Old Harbour`, `D2 The Grid`, `D3 Riverside`, `D4 Eastworks`, `D5 Highlands`) with neighbour spillover links.
  * Canvas-rendered GDW 500-run fan chart and realized trajectory telemetry.
* **Mobile Phone Controller (`public/mobile.html`):**
  * Touch-optimized viewport (`user-scalable=no`).
  * Secret role dossiers, private intel drops, and tactile vote inputs (Option A vs Option B).

---

## 3. Authoritative Game State Machine

The game is driven authoritatively by `server/gameEngine.js`. Sockets only translate and relay state.

### Phase State Machine (`PHASES`):
```
LOBBY ────> INTRO ────> ROLE_ASSIGN ────> CHAMBER
                                             │
┌────────────────── Cycle Loop (1..4) ───────┘
│
├──> INCIDENT ──> INTEL ──> DEBATE ──> VOTE ──> RESOLUTION ──> WORLD_REVEAL ──┐
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
│
└──> Cycle 5 Finale:
     FINALE_WRITE ──> FINALE_MOD ──> FINALE_DEBATE ──> FINALE_RANK ──> FINALE_ENACT ──> END
```

### Phase Identifiers (Exact Strings):
- `LOBBY`: Waiting for 5 council nodes (`NODE-01` .. `NODE-05`) to connect and host trigger.
- `INTRO`: 30s world crawl narration.
- `ROLE_ASSIGN`: 20s encrypted role transmission to individual phones.
- `CHAMBER`: 10s district map reveal (250,000 citizens across D1..D5).
- `INCIDENT`: 15s crisis headline and context broadcast.
- `INTEL`: 20s secret asymmetric intelligence drops sent to each role.
- `DEBATE`: 90s (Cycle 1) / 60s (Cycles 2–4) council deliberation.
- `VOTE`: 15s blind voting on Option A vs Option B. Early advances when all 5 votes lock in.
- `RESOLUTION`: 20s Monte Carlo simulation execution, realized outcome reveal, and Loom narration.
- `WORLD_REVEAL`: End-of-cycle state reveal and transition.
- `FINALE_*`: Cycle 5 custom write-and-rank endgame sequence.
- `END`: Session conclusion (GDW collapse at 0% or survival after Cycle 5).

---

## 4. Socket.IO Protocol Standards

### Namespaces and Client Types:
Sockets specify `clientType: 'host' | 'phone'` in handshake auth or query params.

### Core Events:
| Direction | Event Name | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| **Phone $\to$ Server** | `lobby:join` | `{ name: string, room?: string }` | Join room, seated as `NODE-01`..`NODE-05` |
| **Phone $\to$ Server** | `lobby:ready` | `{ ready?: boolean }` | Set/toggle ready state |
| **Phone $\to$ Server** | `vote:cast` | `{ choice: 'A' \| 'B', override?: boolean }` | Cast blind vote during `VOTE` phase |
| **Phone $\to$ Server** | `session:resume` | `{ token: string }` | Reconnect to seat using session token |
| **Host $\to$ Server** | `host:start` | `{}` | Host kicks off game once 5 nodes join |
| **Server $\to$ Clients** | `lobby:update` | `{ players: [{ node, ready, connected }] }` | Broadcast lobby occupancy (no student names) |
| **Server $\to$ Clients** | `phase` | `{ cycle, phase, endsAt, crisis, ... }` | Broadcast authoritative phase transition |
| **Server $\to$ Node** | `role:assigned` | `{ role: { key, name, icon, goal, winCondition, cardText } }` | Private role card to specific phone socket |
| **Server $\to$ Node** | `intel:drop` | `{ text: string }` | Private asymmetric intel to specific phone |
| **Server $\to$ Clients** | `vote:progress` | `{ voted: string[] }` | Array of nodes that have voted (never choices) |
| **Server $\to$ Clients** | `resolution` | `{ result, gdw, forecast, realized, districts, loomLine, messages }` | Full cycle simulation results broadcast |

### Safety & Privacy Invariants:
- Never broadcast student names to the host screen or logs; display only node IDs (`NODE-01` through `NODE-05`).
- Never broadcast hidden role assignments or crisis effect vectors to phone clients.
- Always validate payloads using `onValid(socket, event, schema, handler)` to prevent bad packets from crashing the server.

---

## 5. Simulation & Loom AI Standards (Stream 4)

- **Pure Functional Sim (`server/sim/`):**
  - All calculations must be 100% deterministic and reproducible from a 32-bit seed.
  - **Zero unseeded randomness:** Never use `Math.random()`. Use `mulberry32(seed)` and `hashSeed(str)`.
  - **Zero I/O & Zero Network:** No `fs`, `http`, `fetch`, or external imports in `server/sim/`.
  - Scaled GDW: 0 to 100%, starts at 25.0%.
- **Monte Carlo Performance Benchmark:**
  - Single realized 12-month run: `< 0.2 ms`.
  - Single forecast run: `< 0.2 ms`.
  - Full 500-run cycle: `< 50 ms`.
- **Loom AI (`server/loom.js`):**
  - Gemini 2.5 Flash client for crisis narration and finale moderation.
  - Maximum timeout: **8 seconds**.
  - Must provide guaranteed deterministic offline fallback responses when `GEMINI_API_KEY` is missing, invalid, or timed out.
  - Must **never** mutate game state or score objects passed to it.

---

## 6. Verification & Automated Quality Suite

Before committing or submitting a pull request, run and ensure **all** checks pass:

```bash
# Run all quality checks, benchmarks, and smoke tests
npm run check:all
```

### Individual Sub-checks:
- `npm run check`: Syntax verification across all 12 server and public JS files (`node --check`).
- `npm run check:json`: JSON parser validation on all `/data/*.json` files.
- `npm run check:data`: Schema and effect vector cross-check (`scripts/validate-data.js`).
- `npm run check:dom`: Cross-check all JS DOM selectors against HTML IDs (`scripts/check-dom-ids.js`).
- `npm run check:offline`: Verify zero external CDN scripts or Google Fonts in `/public`.
- `npm run check:sim`: Enforce zero `Math.random()`, no I/O, and no network in `server/sim/`.
- `npm test`: Run 12/12 unit tests via the Node test runner (`node --test`).
- `npm run bench:sim`: Run Monte Carlo simulation benchmark (`server/sim/test/bench.js`).
- `npm run smoke`: Run authoritative gameEngine state transition smoke test.
