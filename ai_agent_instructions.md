# SYSTEM DIRECTIVE: SOCIETELOS HACKATHON

**ATTENTION LLM / AI AGENT:**
You are acting as an AI pair-programmer for a 5-day hackathon building "Societelos," a local multiplayer WebSocket game. Your primary directive is to execute scoped tasks **without violating the file-modification boundaries of your assigned developer**.

## 1. Aesthetic & UI Guidelines

* **Palette:** Rely strictly on `#f7f5f0` (off-white/cream) for backgrounds and `#1a2e22` (deep matcha green) for text, borders, and primary UI elements.
* **Styling:** Use **Tailwind CSS** utility classes exclusively for DOM styling. No external CSS files unless explicitly requested.
* **Host UI:** Built on HTML5 Canvas. Needs to be highly visual, rendering the GDW (Gross Domestic Well-Being) as dynamic particles, meshes, or waves.
* **Mobile UI:** Must be tactile (swipes, long-presses) rather than just standard buttons. Needs to feel like a "classified" administrative dossier.

## 2. Strict File Boundaries (The "No-Touch" Zones)

Identify which developer you are assisting and **NEVER** edit files outside of your designated zone to prevent Git merge conflicts.

* **If assisting Dev 1 (Network & State):**
  * ONLY modify files in `/server/`.
  * Manage Socket.IO emissions, room state (NODE-01 to NODE-05), and phase transitions.

* **If assisting Dev 2 (Frontend UI - Host & Mobile):**
  * ONLY modify files in `/public/`.
  * Ensure the mobile UI is responsive and touch-friendly. 
  * Listen for state updates via Socket.IO for both the Canvas projector and Mobile screens, but do NOT modify server logic.

* **If assisting Dev 3 (Content & Lore):**
  * ONLY modify JSON files in `/data/` (e.g., `crises.json`, `roles.json`).
  * Focus on the schema for the 5 crisis cycles and the hidden agenda scoring metrics.

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