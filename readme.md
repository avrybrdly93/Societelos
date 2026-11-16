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
* **Backend:** Node.js, Express, Socket.IO
* **Frontend UI:** HTML5 Canvas (Host Projector) + Vanilla JS/Tailwind CSS (Mobile Controllers)
* **Aesthetic Palette:** Matcha Latte (`#f7f5f0` background, `#1a2e22` primary text/accents)

---

## 🚀 Local Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone git@github.com:avrybrdly93/The Loom.git
   cd The Loom
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the local server:**
   ```bash
   npm run dev
   ```
   * `npm start` runs the 4-stream server (`server/server.js`). The pre-hackathon prototype is still available with `npm run start:legacy` (its host page is `public/legacy-host.html`).
   * Checks: `npm run check` (syntax), `npm run check:dom` (DOM ids), `npm run check:offline` (no CDN dependencies), `npm run smoke` (Lobby -> Cycle 1 Resolution). Set `FAST_TIMERS=true` for 3-second phases.
4. **Connect:**
   * **Host Projector:** Navigate to `http://localhost:3000`
   * **Mobile Controllers:** Connect devices to the same local network and navigate to `http://<YOUR_LOCAL_IP>:3000/mobile`

---

## ⏱️ Game Timing (13.5–16 min)

| Segment | Duration |
| :--- | :--- |
| Lobby + Intro (30 s) + Role assignment (20 s) + Council chamber (10 s) | ~1 min |
| Cycles 1–4: Incident 15 s → Intel 20 s → Debate 90 s (or 60 s) → Blind vote 15 s → Resolution 20 s | ~2.6 min each |
| World Reveal after cycle 2 | 10 s |
| Cycle 5 finale: Incident → Write (45 s) → Moderate → Read & debate (60 s) → Rank (30 s) → Enact (20 s) | ~3 min |
| Ending: recap, role reveal, winner | ~1 min |

Debate length is set with `DEBATE_SECONDS` in `.env` (90 → ~16 min game, 60 → ~13.5 min game).

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
