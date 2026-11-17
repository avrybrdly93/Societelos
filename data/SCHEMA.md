# Societelos data schema (frozen Mon 16 Nov 2026)

These three files are the contract between the content, engine and UI streams.
Change a shape only by agreement across streams. Validate with `npm run check:data`.

Shared vocabularies:
- **Role keys:** `artisan`, `lotus`, `assimilator`, `catalyst`, `ghost`
- **Policy role tags:** `artisan`, `lotus`, `assimilator`, `ghost` (the Catalyst scores on GDW swing, never on tags)
- **Traits (effect vector keys):** `purpose`, `connection`, `health`, `trust`, `fairness`, `autonomy`, each a number in [-1, 1]
- **Districts:** `D1`..`D5`. **Cohorts:** `youth`, `workers`, `elders`, `elite`
- **Worlds:** `fixed` (cycles 1-2), `AA`, `AB`, `BA`, `BB`
- No emoji anywhere; school-appropriate language only.

## data/roles.json
Array of exactly 5 roles:
```json
{ "id": "artisan", "name": "The Artisan", "icon": "⚒", "goal": "What the role wants",
  "winCondition": "When the role scores +1", "cardText": "In-universe flavour text" }
```
`icon` is a single Unicode symbol (not an emoji) or an SVG identifier.

## data/citizens.json
Array of the 10 recurring citizens:
```json
{ "id": "mara", "name": "Mara", "age": 58, "district": "D3", "cohort": "workers",
  "voice": "Retired nurse who misses being needed",
  "lines": { "good": ["..."], "mixed": ["..."], "bad": ["..."] } }
```
`lines` are offline fallback messages per outcome band (at least one each, max 140 chars).

## data/crises.json
```json
{
  "worlds": { "AA": { "name": "The Commonwealth", "tagline": "...", "problemLeft": "meaning", "finale": "aa-fake-struggle" } },
  "crises": [
    {
      "id": "aa-purpose-drift", "world": "AA", "cycle": 3,
      "title": "Purpose Drift", "subtitle": "", "incident": "...", "loomIntro": "...",
      "mode": "binary",
      "feed": [ { "citizenId": "mara", "text": "...", "sentiment": "anxious" } ],
      "options": {
        "A": { "name": "...", "text": "...", "roles": ["assimilator"],
               "effects": { "purpose": 0.5, "connection": 0.1, "health": 0, "trust": 0.3, "fairness": 0, "autonomy": -0.6 } },
        "B": { "name": "...", "text": "...", "roles": ["artisan"], "effects": { } }
      },
      "intel": { "artisan": "...", "lotus": "...", "assimilator": "...", "catalyst": "...", "ghost": "..." }
    }
  ]
}
```
- `mode` is `binary` (cycles 1-4) or `writein` (cycle 5 finale; options A/B are the offline fallback).
- **Crisis sets:** a world's binary crises carry `set` (1, 2, ...; missing means 1). Each set needs exactly one cycle 3 and one cycle 4 crisis (AA1, AA2, ...). A game plays one set per world, picked from the game id or forced by the host (`host:config { crisisSet }`). Blitz cycles past 4 borrow the world's other sets. The `writein` finale is shared by every set and has no `set`. Fixed crises have no `set`.
- An option may carry `effectsByWorld` (`{ "A": effects, "B": effects }`, keyed by the cycle 1 result) instead of `effects`, plus `rolesByWorld` the same way. Fixed Crisis 2B uses this.
- An option may set `volatility` (a multiplier on simulation noise and shock odds for the rest of the game; 2A uses 1.5).
- Optional per option: `targetGdwDelta` (tuning target), `loomLine`, `reactions` (citizen lines), and `loomLines` (`{ "good", "mixed", "bad" }`, max 200 chars each): the offline Loom line for each outcome band, preferred over `loomLine` when Gemini is unavailable.
- `draft: true` on an option marks content still being written; the validator warns instead of failing when its effect vector is missing.
- Optional per crisis: `teacherPrompt`, `debateHooks` (string array).
