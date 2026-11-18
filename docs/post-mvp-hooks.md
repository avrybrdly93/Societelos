# Post-MVP hooks

Where the two bonus features from `mvp_spec.md` ("Bonus") plug into the shipped code. Neither is needed for Thursday; both are designed to add to the game without changing the interfaces the MVP depends on.

---

## Bonus 1: the voice of the masses (`data/crowd.json` via Adaption Invent)

**Goal:** thousands of short, labelled citizen posts generated at build time, mixed into the projector feed so the region sounds like 250,000 people, not 10. No API calls during play.

### Data file

`data/crowd.json`, an array of posts (shape proposed here; add it to `data/SCHEMA.md` when it lands):

```json
[
  { "id": "c-000123", "district": "D4", "cohort": "workers", "trait": "fairness",
    "band": "bad", "crisis": "ba-status-wars", "text": "max 140 chars" }
]
```

- `district` D1-D5, `cohort` youth / workers / elders / elite, `trait` one of the six traits, `band` good / mixed / bad, `crisis` a crisis id or `null` for generic posts.
- Build pipeline (offline, once): describe the dataset to Invent, generate 5,000-20,000 rows, reshape the prompt/response pairs into the shape above, drop duplicates, then run every row through the same checks as the authored content: `scripts/validate-data.js` (no emoji, school-appropriate language, 140-char limit). Extend the validator with a `checkCrowd()` that is skipped when the file is absent, so the MVP keeps passing without it.

### Where it plugs in

| Step | File | Hook |
| :--- | :--- | :--- |
| Load | `server/gameEngine.js` | `loadGameData()` already reads `crises`, `roles`, `citizens` from `/data`; add `crowd: readJson(.../crowd.json, [])` (empty array when missing). |
| Match | new pure helper next to `loom.rankCitizensByShift` (`server/loom.js`) | Pick posts whose `district`/`cohort`/`trait` match `simSummary.topMoves` and `simSummary.shocks`, and whose `band` matches `outcomeBand(summary)`. Seed the choice with `hashSeed(gameId, cycle)` so replays stay identical (no `Math.random()`, see the repo hygiene test). |
| Mix | `startResolutionPhase` in `server/gameEngine.js` (the `messages` array of `this.lastResolution`) | Interleave 2-4 crowd posts between the named citizens. Crowd posts have no `citizenId`; send them as `{ name: 'A citizen of <district name>', district, text, sentiment, crowd: true }`. |
| Show | `public/js/host.js` `addFeedItem()` | Already renders `{ name, district, text }` with district colours; a `crowd` item can use a lighter card style in `styles.css`. |

Later uses named in the spec: crowd rows as extra calibration examples for Gemini's effect vectors (`loom.calibrationExamples`), or fine-tuning a small dedicated Loom model.

---

## Bonus 2: The Accord (unanimity minigame)

**Goal:** two contradictory laws; the council must pass one 5-0. Secret vote; if not unanimous, show the split (no names), 60 s in-person debate, revote; up to 3 rounds; if still deadlocked, the Loom imposes a law and gridlock costs GDW.

### Engine

| Step | File | Hook |
| :--- | :--- | :--- |
| Phases | `server/gameEngine.js` `PHASES`, `PHASE_STARTERS`, `DEFAULT_PHASE_SECONDS` | Add `ACCORD_INCIDENT`, `ACCORD_VOTE`, `ACCORD_SPLIT` (shows "3-2", 60 s debate) and `ACCORD_RESULT`. |
| Trigger (in-game) | `nextPhase()` `case P.RESOLUTION` | After Cycle 4, when the last forecast's `pCollapse > 0.3`, go to `ACCORD_INCIDENT` before the finale (spec: "Emergency Session"). |
| Trigger (standalone) | lobby `host:config` (`GameState.configure()`) | A `mode: 'accord'` setting that plays N Accord rounds back to back instead of cycles. |
| Voting | `castVote()` / `allVotesIn()` | Reuse as is: the Accord is a binary vote. Unanimity = all five votes equal; Overrides should not apply (a doubled vote cannot make 5-0). |
| Outcome | `simulate(state, effects, ...)` | Unanimous: the law's effects plus a unity bonus (e.g. `+0.1 trust, +0.1 connection`); deadlock after 3 rounds: a Loom-imposed law with a gridlock penalty. Keep the numbers in `data/sim.json` (`constants.accord`) per the "every tunable number lives there" rule. |
| Privacy | `sanitizeForBroadcast` | Broadcast only the split counts (`{ A: 3, B: 2 }`), never who voted what. |

### Content

`data/crises.json` gains an inactive-by-default `accord` list (same pattern as `v2_spares`): `{ id, title, laws: { A: {name, text, roles, effects}, B: {...} }, imposed: {...} }`. Hidden roles make holdouts interesting, so tag both laws.

### Screens

The phone vote screen (`#m-view-vote`) and the projector policy cards (`.policy-panel`) are reused; new pieces are the split banner ("3-2: NO ACCORD") and the round counter (Round 2/3).

---

## Already in place for both

- `simulate()` interface boundary: `server/sim/index.js` header (TASK-751).
- Seeded randomness only (`server/sim/prng.js`, `hashSeed`), enforced by `npm run check:sim` and `server/test/repoHygiene.test.js`.
- Content validation: `npm run check:data`; content summary: `npm run content:report`.
- Inactive content pattern: `v2_spares` in `data/crises.json` (TASK-723).
