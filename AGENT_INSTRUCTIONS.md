# SYSTEM DIRECTIVE: SOCIETELOS HACKATHON

**ATTENTION LLM / AI AGENT:**
You are acting as an AI pair-programmer for a 5-day hackathon building "Societelos," a local multiplayer WebSocket game. There are **4 workstreams** (Network & State, Host & Mobile UI, Content & Lore, Simulation & Loom AI). Your primary directive is to execute scoped tasks **without violating the file-modification boundaries of your assigned developer**.

## 1. Aesthetic & UI Guidelines

* **Palette:** Rely strictly on `#f7f5f0` (off-white/cream) for backgrounds and `#1a2e22` (deep matcha green) for text, borders, and primary UI elements.
* **Styling:** Use **Tailwind CSS** utility classes exclusively for DOM styling. No external CSS files unless explicitly requested.
* **Host UI:** Built on HTML5 Canvas. Needs to be highly visual, rendering the GDW (Gross Domestic Well-Being) as dynamic particles, meshes, or waves.
* **Mobile UI:** Must be tactile (swipes, long-presses) rather than just standard buttons. Needs to feel like a "classified" administrative dossier.

## 2. Strict File Boundaries (The "No-Touch" Zones)

Identify which workstream you are assisting and **NEVER** edit files outside of its zone. Ownership is by exact file path or directory, not by "nearby" files. If a change you need belongs to another stream, stub against the agreed interface and leave a note instead of editing their file.

| Stream | Branch | May modify | Must NOT modify |
| :--- | :--- | :--- | :--- |
| **1. Network & State** | `feature/backend` | `server/server.js`, `server/socket.js`, `server/gameEngine.js`, `README.md`, `AGENT_INSTRUCTIONS.md`, `package.json`, `.env.example` | `public/**`, `data/**`, `server/sim/**`, `server/loom.js` |
| **2. Host & Mobile UI** | `feature/frontend` | `public/index.html`, `public/mobile.html`, `public/css/*`, `public/js/*` | `server/**`, `data/**` |
| **3. Content & Lore** | `feature/content` | `data/crises.json`, `data/roles.json`, `data/citizens.json` | `server/**`, `public/**`, `data/sim.json` |
| **4. Simulation & Loom AI** | `feature/sim` | `server/sim/*`, `server/loom.js`, `data/sim.json` | `server/server.js`, `server/socket.js`, `server/gameEngine.js`, `public/**`, other `data/*.json` |

Rules for every stream:
* Work only on your stream's branch. **Never commit directly to `main`.**
* Never commit secrets. `GEMINI_API_KEY` lives only in a local `.env` (see `.env.example`).
* Data schemas and socket event payloads are frozen from Monday; change them only by agreement across streams.
* Stream 4 code must be deterministic: use the seeded PRNG, never `Math.random()`. All Gemini calls go through `server/loom.js` with an 8 s timeout and an offline fallback.
* Stream 1 consumes Stream 4 through `simulate(state, effects, { runs, seed })`, `loom.moderate(submissions, crisis)` and `loom.narrate(context)`; until those land, use the stubs in `server/gameEngine.js`.

## 3. Game State Machine Standards

When implementing Socket.IO events, adhere to these standardized phase strings:

1. `STATE_LOBBY`: Waiting for 5 `NODE` connections.
2. `STATE_CRISIS_INTRO`: Broadcasting the incident text and Canvas animation.
3. `STATE_INTEL_DROP`: Sending secret JSON payloads to specific mobile sockets.
4. `STATE_VOTING`: Awaiting 5 binary vote inputs.
5. `STATE_RESOLUTION`: Calculating the vote, adjusting GDW, and updating the Host Canvas.
6. `STATE_GAME_OVER`: Triggered if GDW hits 0% or after Cycle 5.

## 4. Code Generation Rules

* Do not delete existing boilerplate unless instructed.
* Keep functions small and modular.
* If proposing a data schema (e.g., for Socket.IO payloads), format it cleanly in JSON before implementing the JavaScript logic.