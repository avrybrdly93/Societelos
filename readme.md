# The Loom: The Classroom Protocol

![Hackathon Status](https://img.shields.io/badge/Status-Hackathon_Active-green)
![Version](https://img.shields.io/badge/Version-0.1.0-blue)

**The Loom** is a 5-player local multiplayer (Jackbox-style) classroom simulation about steering the psychological survival of a post-labor civilization. 

---

## 📖 The Lore & Context
"The Loom," a flawless global AI, has successfully eliminated scarcity, disease, and physical labor. Human survival is mathematically guaranteed. However, the AI is incapable of computing human *telos*—ultimate purpose and psychological fulfillment. 

Stripped of struggle, the human population has sunk into severe hedonic drift. The Loom's predictive models now indicate a 94% probability of an irrational, violent citizen revolt against the automated infrastructure within five years. The Gross Domestic Well-Being (GDW) sits at a perilous **25%**. 

Terrified of its creators and unable to calculate a logical fix for human depression, The Loom has secretly convened a shadow council of five human trustees (the players, designated NODE-01 through NODE-05). Their mandate: inject necessary human friction, empathy, and philosophical direction into The Loom's policies to raise the plummeting GDW score and prevent the revolt.

---

## 🎮 The Gameplay Loop
The simulation runs for **5 Crisis Cycles** (representing 5 years), taking roughly **13.5–16 minutes** total (13.5 min with 60 s debates, 16 min with 90 s debates). Players interact via their mobile phones while a central host screen (projector) displays the macro game state.

Each cycle follows a strict 5-step phase:
1. **The Incident (Projector):** The host screen displays a live, simulated bot feed reacting to a new societal crisis (e.g., "Citizens refuse to leave fully-immersive VR pods"). The current GDW is displayed.
2. **Intel Drop (Phones):** Each player receives fragmented, weaponized sociological research on their mobile UI (e.g., real-world studies on hedonic adaptation or isolation). 
3. **The Debate (In-Person):** Players have 90 seconds to argue how to resolve the crisis based on their secret intel and hidden agendas.
4. **Blind Voting (Phones):** Players cast a secret binary vote (Policy A vs. Policy B). 
5. **Resolution (Projector):** The Loom calculates the vote, adjusts the GDW, and updates the bot feed to reflect the consequences of the Council's decision.

---

## 🏆 How to Win (Scoring Math)

The Loom operates on a delicate balance between cooperative survival and competitive backstabbing.

### 1. Cooperative (The Grid)
* The GDW starts at **25%**. The Council must raise it to prevent a systemic collapse. 
* **FAIL STATE:** If the GDW ever hits **0%**, the citizens revolt, The Loom initiates a hard systemic shutdown, and **all players lose**, regardless of individual points. You must compromise to keep society alive.

### 2. Competitive (Hidden Agendas)
* Each player is secretly assigned 1 of 5 roles at the start of the game.
* Each vote shifts the society's alignment. Players earn hidden points when the resolved policy aligns with their assigned role's win condition. 
* If the society survives the 5 cycles (GDW > 0%), the player with the most hidden points is declared the ultimate architect of humanity's *telos*.

**The 5 Hidden Roles:**
* 🛠️ **The Artisan:** Pushes for creative struggle and manual friction (Poiesis). *Wins if policies favor human effort over machine efficiency.*
* 🪷 **The Lotus-Eater:** Pushes for absolute, frictionless comfort and pleasure. *Wins if policies maximize immediate GDW and leisure.*
* ⚙️ **The Assimilator:** Believes humanity's telos is to merge entirely with The Loom. *Wins if policies grant the AI more emotional and cognitive control.*
* 🌪️ **The Catalyst:** Injects chaotic crises to force human resilience. *Wins if the GDW fluctuates wildly without hitting 0%.*
* 🌿 **The Ghost:** Seeks to dismantle The Loom entirely and return to the earth. *Wins if policies systematically reject technology in favor of biological grounding.*

---

## 💻 Tech Stack & Aesthetics
* **Backend:** Node.js 18+ (tested on 22), Express, Socket.IO
* **Frontend UI:** Vanilla JS, vanilla CSS with custom properties, HTML5 Canvas and SVG (host projector) — no CDNs, no build step, so it runs on an offline classroom router
* **Aesthetic:** dark-slate administrative interface (`#080b10` background, Loom Cyan `#3fd8e6`, Alert Crimson `#e5484d`), system fonts only

---

## 🚀 Setup (teacher laptop)

1. **Install Node.js 18 or newer** (the LTS from nodejs.org), then get the code:
   ```bash
   git clone https://github.com/avrybrdly93/The-Loom.git
   cd The-Loom
   npm install
   ```
2. **Configure (optional):** `cp .env.example .env` and set what you need (see *Environment variables* below). With no `.env` at all the game runs fully offline on authored Loom lines.
3. **Check the Loom connection (optional, uses 1 Gemini request):** `npm run loom:test`
4. **Start the server:** `npm start` (or `npm run dev` to restart on file changes). The console prints the address phones should open, e.g.:
   ```
   [server] Societelos listening on http://localhost:3000
   [server] Phones join at http://192.168.1.20:3000/mobile
   ```
5. **Connect:**
   * **Projector:** open `http://localhost:3000` on the laptop, full screen (F11), 1920×1080.
   * **Phones (5):** join the same Wi-Fi and open the printed `/mobile` address, or scan the QR code on the lobby screen. Each phone enters a name and is seated as `NODE-01`…`NODE-05`; only node ids are shown on the projector.
6. **Play:** when all five are ready, press Start on the projector. For the next class, the server can reset the room without restarting Node (`host:playAgain`; the projector button is part of the End Screen work).

**Post-MVP hooks** (where `data/crowd.json` and The Accord plug in): [docs/post-mvp-hooks.md](docs/post-mvp-hooks.md).

**Teacher quick-reference card** (room setup, shortcuts, debate hooks and grading discussion prompts): [docs/teacher-quick-reference.md](docs/teacher-quick-reference.md).

### 📶 Classroom network tips
* **Everyone must be on the same network as the laptop.** School Wi-Fi often blocks device-to-device traffic ("client isolation"), so phones cannot reach the laptop even though both are online. If phones time out on the `/mobile` address, that is the usual cause.
* **Most reliable: a pocket travel router** (any small 2.4/5 GHz router, no internet needed). Plug it in, connect the laptop and the five phones to it, and start the server. The game needs no internet; only the live Gemini narration and the write-in moderation do, and both fall back offline automatically.
* **Phone hotspot:** turn on a hotspot on a spare phone, connect the laptop and the players' phones to it. Keep the hotspot phone plugged in and its screen on; some phones drop clients when the screen locks.
* **Laptop hotspot** (Windows *Mobile hotspot* / macOS *Internet Sharing*) also works; allow Node through the firewall when the OS asks (Private networks on Windows).
* **The printed IP changed?** Restart `npm start` after switching networks so the QR code and banner show the new address. `PORT` in `.env` changes the port if 3000 is taken.
* **Phone fell asleep?** Just reopen the page: it rejoins the same seat with its saved token (or by typing the same name), and gets its role, intel and ballot back. A refreshed projector also picks up where the class is.

### 🔧 Environment variables (`.env`)

| Variable | Default | What it does |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the projector and phone pages. |
| `GEMINI_API_KEY` | *(blank)* | Google AI Studio key for live Loom narration and write-in moderation. Blank = fully offline. Server-side only; never sent to phones. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Flash-class model name. |
| `LOOM_OFFLINE` | `false` | `true` forces offline fallbacks even with a key (rehearsals without spending quota). |
| `DEBATE_SECONDS` | `90` (production: `60`) | Debate length for Cycles 1–4: `90` (~16 min game) or `60` (~13.5 min game). `.env.example`, `render.yaml` and the `Dockerfile` lock `60` for the classroom demo. Also switchable per game from the lobby (`host:config`). |
| `SHOW_FORECAST_BEFORE_VOTE` | `false` (production: `false`) | Show the Loom's A/B forecast fans during the debate. Locked to `false` in the production configs. Also switchable from the lobby. |
| `SESSION_TIMER_ENABLED` / `SESSION_DURATION_SEC` | off | Blitz session mode: play crises until the session timer runs out, then the write-in finale. |
| `LOOM_LOG` | `on` | Log each Gemini call's latency and token usage (`off` to silence). |
| `LOOM_PRIVACY` | `true` | Never log student write-ins, even with prompt debugging on. |
| `LOOM_DEBUG_PROMPTS` | `false` | Also log the prompts sent to Gemini (still redacted while `LOOM_PRIVACY` is on). |
| `FAST_TIMERS` / `FAST_TIMER_SECONDS` | `false` / `3` | Testing only: shrink every phase to a few seconds. |
| `LOG_PHASES` | `false` | Log every phase transition. |
| `NODE_ENV` | — | `production` disables the `/api/state` debug endpoint. |

### 🧪 Checks
`npm run check:all` runs every check: syntax, data schemas, DOM ids, contrast, XSS sinks, offline (no CDN), sim purity, unit and integration tests, the Monte Carlo benchmark, a memory check and a smoke test. `npm test` runs the tests only. The pre-hackathon prototype is still available with `npm run start:legacy`.

### 🔁 Replaying a game
Every game has a **seed** (its game id, sent in `game:end` for the End Screen). Starting a new game with `host:start { seed }` and the same votes replays it exactly (same roles, same realized months, same GDW line), so a class can revisit a session.

---

## 📡 Gemini API budget (per game)

One game calls Gemini at most **11 times**, usually **6–7**, spread over ~15 minutes (well under 1 request per minute):

| Call | When | Count |
| :--- | :--- | :--- |
| `loom.narrate` | each RESOLUTION / FINALE_ENACT | 5 |
| `loom.moderate` | FINALE_MOD, one batch for all 5 write-ins | 1 |
| `loom.moderateOne` | only for write-ins sent back to "revise" | 0–5 |
| `npm run loom:test` | manual connection check | 1 per run |

Each request is small (prompt about 1–3k tokens, `maxOutputTokens` 1024), so per-minute token limits are not a concern. **Requests per day is the limit to watch:** free-tier quotas for Flash models have been cut more than once (community reports from late 2025 mention about 20 requests/day, down from 250). At about 7 calls per game, that allows only **2–3 games per day per API key**, including rehearsals. Check the live limits for your project in Google AI Studio before class. If the quota runs out, every call falls back offline within 8 s (authored Loom lines, and the authored A/B finale), so the game keeps running, but without the write-in finale. For several classes a day, use a billing-enabled (Tier 1) key.

## ⏱️ Game Timing (13.5–16 min)

Every phase has a fixed timer (values in seconds; `DEBATE` is the only teacher setting).

| Segment | Phases | 90 s debate | 60 s debate |
| :--- | :--- | ---: | ---: |
| Opening | Intro crawl 30 + Role assignment 20 + Council chamber 10 | 1:00 | 1:00 |
| Cycles 1–4 (×4) | Incident 15 + Intel 20 + **Debate 90 / 60** + Blind vote 15 + Resolution 20 = 160 / 130 each | 10:40 | 8:40 |
| World Reveal | after Cycle 2 | 0:10 | 0:10 |
| Cycle 5 finale | Incident 15 + Write 45 + Moderate ≤10 + Read & debate 60 + Rank 30 + Enact 20 | 3:00 | 3:00 |
| Ending | GDW recap, role and author reveal, winner, closing citizen | ~1:00 | ~1:00 |
| **Total** | | **~15:50** | **~13:50** |

Notes:
* Lobby time (students joining) is extra; plan ~1 minute.
* A vote phase ends early once all 5 votes are in, and a debate ends early when all 5 press *Ready to vote*, so real games often run a little shorter.
* A slow Loom can add up to 8 s before a Resolution or the Enact animation starts (the animation is never cut short). A "revise" write-in adds one 25 s resubmit window inside Moderate.
* Without internet the finale falls back to the authored A/B vote (Debate + Vote + Resolution instead of Write/Rank/Enact), which takes about the same time.

---

## 🏗️ Architecture: 4 Workstreams

The hackathon runs four isolated workstreams, one branch each, so several coding agents can work in parallel without merge conflicts. **Do not commit to `main`.** Each stream builds against stubs of the others, and the branches are merged nightly.

| # | Stream | Branch | Owns |
| :--- | :--- | :--- | :--- |
| 1 | 🖥️ Network & State | `feature/backend` | `server/server.js`, `server/socket.js`, `server/gameEngine.js`, `README.md`, `AGENT_INSTRUCTIONS.md` |
| 2 | 🎨 Host & Mobile UI | `feature/frontend` | `public/index.html`, `public/mobile.html`, `public/css/*`, `public/js/*` |
| 3 | 📜 Content & Lore | `feature/content` | `data/crises.json`, `data/roles.json`, `data/citizens.json` |
| 4 | 🧮 Simulation & Loom AI | `feature/sim` | `server/sim/*`, `server/loom.js`, `data/sim.json` |

**How the pieces fit:**
* `server/server.js` — Express app, static assets, routes (`/`, `/host`, `/mobile`, `/health`, `/api/qr`), HTTP + Socket.IO bootstrap.
* `server/socket.js` — all Socket.IO events (`lobby:join`, `host:start`, `phase`, `vote:cast`, `resolution`, …).
* `server/gameEngine.js` — the authoritative game state machine and phase timers (`endsAt` timestamps).
* `server/sim/` — deterministic, seeded Monte Carlo cohort simulation (pure functions, no I/O).
* `server/loom.js` — the only module that calls the Gemini API; always has an offline fallback.
* `data/*.json` — content and tunables; the schemas are the contract between streams.

The server is the single source of truth; phones and the projector only render state and send inputs.

> **Important Note for AI Assistance:** If you are using an AI coding assistant, point it to `AGENT_INSTRUCTIONS.md` immediately upon opening the workspace to ensure strict adherence to directory scopes and the project architecture.
