# SOCIETELOS: AI PROJECT CONTEXT

**System Directive for AI Assistants:** 
You are acting as an AI pair-programmer for a 4-day hackathon building "Societelos", a 5-player local multiplayer classroom game. Read this document to understand the architecture, your boundaries, and the core logic before generating code.

## 1. Project Overview
* **Game:** Societelos (Web-based, Jackbox-style local multiplayer).
* **Premise:** "The Loom" AI has automated all labor. Human survival is guaranteed, but purpose is lost. 5 secret human trustees (the players) must steer society through 5 Crisis Cycles via their phones, managing Gross Domestic Well-Being (GDW) while pursuing secret hidden agendas.
* **Hardware:** 1 Host PC (Projector) + 5 Mobile Phones (Controllers).
* **Tech Stack:** Node.js, Express, Socket.IO, Vanilla JS, HTML5 Canvas, Tailwind CSS, Google Gemini API.

## 2. strict File Boundaries & Workstreams
The hackathon is divided into 4 isolated workstreams. **Only write code for the workstream you are currently assigned to.** Do not touch files owned by other streams to avoid merge conflicts.

* **Stream 1: Network & State (`feature/backend`)**
  * Scope: `server/server.js`, `server/socket.js`, `server/gameEngine.js`
  * Responsibility: Phase timers, socket events, game state machine.
* **Stream 2: UI & Canvas (`feature/frontend`)**
  * Scope: `public/index.html`, `public/mobile.html`, `public/js/*`, `public/css/*`
  * Responsibility: Tailwind styling (Matcha Latte aesthetic: `#f7f5f0`, `#1a2e22`), Canvas visualizations, mobile DOM manipulation.
* **Stream 3: Content & Lore (`feature/content`)**
  * Scope: `data/crises.json`, `data/roles.json`, `data/citizens.json`
  * Responsibility: JSON schemas, story branching, role definitions.
* **Stream 4: Simulation & Loom AI (`feature/sim`)**
  * Scope: `server/sim/*`, `server/loom.js`, `data/sim.json`
  * Responsibility: Monte Carlo simulation, Gemini API wrapping, GDW math.

## 3. Core Engine Mechanics
* **State Truth:** The server is the absolute source of truth. Mobile clients only render state and send inputs (`vote:cast`, `finale:submit`).
* **Game Loop (5 Cycles):** Incident (Projector) -> Intel Drop (Phones) -> Debate (In-person) -> Blind Vote (Phones) -> Resolution (Projector).
* **The GDW (Health Bar):** Starts at 25%. If realized GDW hits 0%, the game immediately ends in a Fail State (everyone loses).
* **The Simulation:** A deterministic Monte Carlo simulation (using a seeded PRNG, *never* `Math.random()`). 500 forecast runs + 1 realized run. Updates run monthly over 12 months per cycle.
* **Scoring:** Players score hidden points if the winning policy tags match their assigned secret role (Artisan, Lotus-Eater, Assimilator, Ghost, Catalyst).

## 4. Gemini API ("The Loom") Integration Rules
* **Module Location:** All LLM calls must be isolated in `server/loom.js`.
* **Jobs:** Moderating write-in policies (Cycle 5), scoring policies on 6 trait vectors `[-1.0 to 1.0]`, and narrating resolution feeds.
* **Constraints:** 
  * Maximum 8-second timeout.
  * Must enforce strict JSON response schemas.
  * Must always have a hardcoded offline fallback (e.g., Authored A/B responses or template strings) if the API fails or times out.
  * Never let the AI set game scores directly; it only outputs vector numbers which the simulation then processes.

## 5. Development Philosophy
* **Interfaces First:** Stub all functions and JSON schemas immediately so parallel workstreams don't block each other.
* **Resilience:** The game must be able to run a full 5-cycle loop completely offline (using fallbacks and authored data) by Thursday.