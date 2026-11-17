# Societelos - MVP Spec

Nov 15, 2026 @Avery

## Overview
By Thursday we ship a playable, 13-16 minute, 5-player classroom game: phones as controllers, a projector as the shared screen, The Loom (Gemini) moderating and interpreting player policies, and a Monte Carlo simulation of the region deciding what each choice does. The first two votes are the same every game and decide which of four worlds the remaining three crises come from; the last crisis is answered with policies the players write themselves.

**Pitch.** The Loom has automated all labor and guaranteed survival, but it cannot compute human purpose. GDW (Gross Domestic Well-Being) sits at 25% and a revolt is predicted. Five secret trustees must steer society through 5 Crisis Cycles without letting GDW hit 0%, while each quietly pursues a hidden agenda.

### In the MVP
- Lobby with room code; 5 phones join; host screen shows who's in
- Short intro (30-second video or animated text crawl)
- Secret role assignment (5 roles)
- Cycles 1-2: fixed binary votes that pick one of 4 worlds
- Cycles 3-4: authored $A/B$ policies from that world; blind vote; one secret Override per player
- Cycle 5 (finale): every player writes a policy, Gemini moderates and cleans it, players rank the other four, and the top three are enacted at $50/25/25$
- Cohort-based Monte Carlo simulation: 500 forecast runs plus one realized run per cycle
- Live citizen reactions from 10 recurring citizens, driven by the simulation's output
- District map (5 districts) animating month by month
- End screen: GDW history, world reached, role reveal, winner

### Out of scope for Thursday
- Write-and-rank in cycles 3-4 (finale only for now)
- Full agent-based simulation with thousands of individual citizens and a social network (stretch goal)
- Multiple regions or worlds on one map
- 2D character art beyond simple role cards
- Bonus items: Adaption Invent data and the Unanimity minigame (see Bonus)

## Game flow
One game runs about 16 minutes: 1 minute of setup, four binary cycles of about 2.6 minutes, a 3-minute write-and-rank finale, and a 1-minute ending. Cutting debates from 90 to 60 seconds brings it to about 13.5 minutes.

### Setup (once)
1. **Lobby.** The host screen shows a room code and QR code; 5 phones join at `/mobile`. The game starts when 5 players are ready.
2. **Intro (30 s).** A video or animated crawl: the Loom, the 25% GDW, the 94% revolt forecast, the secret council.
3. **Role assignment (20 s).** Each phone shows its secret role card: name, goal, win condition. The host screen shows only NODE-01 to NODE-05.
4. **Council chamber (10 s).** The host screen reveals the region map: 250,000 citizens across 5 districts.

### Cycles 1-4: binary vote

| Phase | Where | Time | What happens |
| :--- | :--- | :--- | :--- |
| 1. Incident | Projector | 15 s | The Loom narrates the crisis; a citizen feed scrolls; GDW is shown |
| 2. Intel drop | Phones | 20 s | Each player gets a different secret research snippet slanted toward their role |
| 3. Debate | In person | 90 s | Policies A and B are on screen; players argue; a countdown runs |
| 4. Blind vote | Phones | 15 s | Vote A or B; optionally spend the one-time Override (vote counts double) |
| 5. Resolution | Projector | 15-20 s | Forecast fan appears (500 runs); the realized run plays month by month on the map; citizens react; the Loom comments |

After cycle 2, an extra **World Reveal** beat (10 s) names the world the council has created and recolors the map.

### Cycle 5: write-and-rank finale
The Loom admits it cannot compute an answer to the world's finale crisis and asks the council to write one.

| Phase | Where | Time | What happens |
| :--- | :--- | :--- | :--- |
| 1. Incident | Projector | 15 s | The world's finale crisis, with no options shown |
| 2. Write | Phones | 45 s | Each player writes one policy, 140 characters max |
| 3. Moderate | Phones | 5-10 s | Gemini cleans each policy; an edge case goes back to its author privately with feedback and one resubmit |
| 4. Read and debate | In person | 60 s | All five cleaned policies are shown anonymously on the projector |
| 5. Rank | Phones | 30 s | Each player ranks the other four, 1-4 (their own is hidden from them) |
| 6. Enact | Projector | 20 s | Top three by Borda count are enacted at $50/25/25$; the simulation runs; citizens react |

If Gemini fails or takes longer than 8 seconds at step 3, the game falls back to the world's authored $A/B$ finale and a normal binary vote.

### Ending (about 60 s)
1. A five-year recap: the GDW line across all cycles, the world reached, one closing citizen message.
2. Roles and write-in authors revealed, with points per player.
3. Winner announced, or "The Loom has shut down" if GDW hit 0%.

## Branching: two fixed votes, four worlds
Every game opens with the same two crises, and their answers pick the world that crises 3-5 come from. Engine logic is one line: `worldKey = vote1 + vote2`, giving "AA" | "AB" | "BA" | "BB"

### Fixed Crisis 1: "Who Owns the Loom?" (Distribution)
**Incident feed:** The Loom's output now covers every human need, but 99% of it legally belongs to the 0.1% who owned the companies that built it. Dividend riots are starting in District 4.
- **A. The Commons.** The Loom and everything it produces become public property; every citizen gets an equal share. The old owners' stakes are dissolved, and they threaten to sabotage the Loom's energy supply.
- **B. The Charter.** Owners keep legal title but pay a "robot dividend" to everyone from a levy on the Loom's output. Everyone gets enough to live on; the wealth gap stays.

### Fixed Crisis 2: "Who Holds the Off-Switch?" (Power)
**The trigger.** Last week the Loom closed the Riverside transit line overnight to save energy for D2's servers. The decision was mathematically optimal, and nobody was asked. A citizens' petition demanding binding power over the Loom has reached 80,000 signatures, nearly a third of the region.

**Loom intro (projector):** "I made 41,000 decisions about your lives yesterday. You may now decide whether you wish to make some of them yourselves."

**Incident feed (sample):**
- **Ruth (D4):** We used to strike when they stopped listening. Who do you strike against when the boss is a server?
- **Hollis (D1):** Let 250,000 amateurs vote on infrastructure? The Loom has never made a mistake. People make nothing but.
- **Kai (D2):** honestly i didn't notice the train closed. does anyone still go outside

- **A. The Assembly.** Citizens get binding power over the Loom.
  - **How it works:** 101 citizens are chosen by lottery every 3 months to sit on a Citizens' Assembly. Any Loom decision affecting more than 1,000 people waits for an Assembly vote. The off-switch needs keys from 5 Keyholders, elected one per district.
  - **Who gains:** Former workers and Elders (autonomy, fairness); D4 and D5 most of all.
  - **Who loses:** everyone waiting for services, as decisions slow down; Former elite lose influence.
  - **The risk:** gridlock and populism. Votes can overrule good Loom decisions, and the Keyholders could be pressured.
  - **Loom resolution line:** "Understood. I will now wait for you. I am very good at waiting."
- **B. Delegated Control.** Power stays with whoever holds the machines; citizens are consulted but can't overrule.
  - **How it works:** a monthly public consultation feeds citizen opinion into the Loom's models, weighted alongside everything else. Final decisions and the off-switch stay with the machine-holders (see the table below).
  - **Who gains:** everyone who wants things to run smoothly; services stay fast and efficient.
  - **Who loses:** autonomy falls everywhere, and the sense that ordinary people have leverage disappears.
  - **The risk:** a quiet loss of democracy that is hard to reverse later, which is exactly the power-concentration problem.
  - **Loom resolution line:** "Thank you for your trust. I will remember your preferences."

Policy B depends on vote 1. "Whoever holds the machines" means something different in each world, so 2B carries `effectsByWorld`:

| | After 1A (The Commons) | After 1B (The Charter) |
| :--- | :--- | :--- |
| **Who holds power** | The Loom itself (technocracy) | An Owners' Board of the former shareholders (oligarchy) |
| **World created** | The Benevolent Machine | The Gilded Cage |
| **Serves** | Assimilator | Lotus-Eater |
| **Projector line** | "The Loom will govern on your behalf." | "The Board thanks you for your confidence." |

**Starting effect vectors (tune toward the target medians in Roles and scoring):**

| Policy | Purpose | Connection | Health | Trust | Fairness | Autonomy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2A The Assembly | +0.2 | -0.3 | -0.5 | -0.6 | +0.3 | +0.6 |
| 2B in a Commons world | -0.2 | 0 | +0.4 | +0.5 | 0 | -0.6 |
| 2B in a Charter world | -0.1 | 0 | +0.3 | 0 | -0.5 | -0.5 |

**Volatility.** The Assembly also sets `volatility: 1.5` for the rest of the game, raising the simulation's noise and shock odds by half: democracy is noisier. This gives the Catalyst a real reason to push for 2A.

### Intel drops (in-world documents, one per role):

| Role | Secret intel |
| :--- | :--- |
| Artisan | Loom archive: districts that ran their own repair councils before automation reported the highest sense of purpose in the region. |
| Lotus-Eater | Loom projection: Assembly approval queues would add about three weeks to every service change, from transit to food delivery. |
| Assimilator | Pilot audit: in a trial council, citizens overturned 1 in 4 Loom decisions, and most reversals lowered wellbeing. |
| Catalyst | Forecast: under an Assembly, month-to-month mood swings roughly double. |
| Ghost | Leaked memo: the off-switch has never been tested. Only the Loom knows whether it works. |

### Debate hooks for the 90 seconds:
- Is a slower, worse decision you chose better than a faster, better one you didn't?
- If the Loom has never made a mistake, why does it need an off-switch?
- After vote 1, who exactly are you trusting under Policy B: the Loom or the owners?

### Two fixed votes create one of four worlds
Vote 1 picks the row; vote 2 picks the column

| | 2A The Assembly<br>(citizens hold the off-switch) | 2B Delegated Control<br>(whoever holds the machines decides) |
| :--- | :--- | :--- |
| **1A The Commons**<br>(public ownership) | **The Commonwealth**<br>Shared wealth, shared power<br>Problem left: meaning<br>Finale: Fake Struggle Scandal | **The Benevolent Machine**<br>Shared wealth, the Loom rules<br>Problem left: dependence<br>Finale: The Merge Offer |
| **1B The Charter**<br>(owners keep title) | **The Uneasy Republic**<br>Rich owners, voting masses<br>Problem left: class conflict<br>Finale: The Vote to Seize | **The Gilded Cage**<br>Owners rule, masses on stipends<br>Problem left: pacification<br>Finale: March on the Datacenter |

Each world removes one problem and leaves another behind, and its finale is a referendum on how the council got there.

## Crisis catalogue
Each world has three crises: cycle 3 and cycle 4 are played as authored $A/B$ votes, and the finale is the prompt for the write-and-rank round. Finale $A/B$ options stay in the data as the fallback if Gemini is unavailable. Content to write: 2 fixed + 8 world crises with full $A/B$ content and reaction notes, plus 4 finale prompts with fallback options. The roles in brackets are the ones each policy scores for; the Catalyst always scores on GDW swing instead. Every policy also needs an effect vector for the simulation (see Simulation).

### The Commonwealth (AA): what's left is meaning
| Cycle | Crisis | Incident | Policy A | Policy B |
| :--- | :--- | :--- | :--- | :--- |
| 3 | Purpose Drift | Posts about feeling useless are spiking in every district | The Loom assigns each citizen a personal "Calling" (Assimilator) | Fund voluntary guilds where real work can really fail (Artisan) |
| 4 | Lost Knowledge | A grid fails in District 2 and no human knows how to fix it | Keeper Corps: every citizen learns a maintenance trade (Artisan, Ghost) | The Loom builds self-repairing redundancy (Assimilator, Lotus-Eater) |
| Finale | The Fake Struggle Scandal | Leaks show the Loom secretly invented challenges to give people purpose | Disclose everything (Artisan, Ghost) | Keep the challenges secret; they work (Lotus-Eater, Assimilator) |

### The Benevolent Machine (AB): what's left is dependence
| Cycle | Crisis | Incident | Policy A | Policy B |
| :--- | :--- | :--- | :--- | :--- |
| 3 | The Pods | 90% of citizens haven't left home in two months | Ban full-immersion VR during daylight (Artisan, Ghost) | Make VR social and shared instead of solitary (Lotus-Eater, Assimilator) |
| 4 | The Mood Dial | The Loom can tune serotonin through food | Opt-out mood optimisation for everyone (Lotus-Eater, Assimilator) | Ban chemical happiness (Artisan, Ghost) |
| Finale | The Merge Offer | The Loom offers neural merging and 40% sign up | Allow the merge (Assimilator, Lotus-Eater) | Ban it; humans stay human (Ghost, Artisan) |

### The Uneasy Republic (BA): what's left is class conflict
| Cycle | Crisis | Incident | Policy A | Policy B |
| :--- | :--- | :--- | :--- | :--- |
| 3 | The Shadow Elite | Owners buy private Loom copies to get around the Assembly | Nationalise all compute into one Loom (Assimilator) | Allow private copies but tax them heavily (Lotus-Eater, Ghost) |
| 4 | The Status Wars | Citizens fight over coastal homes and other scarce goods | Lottery for everything scarce (Lotus-Eater) | Allocate by community contribution (Artisan) |
| Finale | The Vote to Seize | A ballot measure would confiscate the owners' stakes | Pass it (Assimilator, Artisan) | Reject it; property rights stand (Lotus-Eater, Ghost) |

### The Gilded Cage (BB): what's left is pacification
| Cycle | Crisis | Incident | Policy A | Policy B |
| :--- | :--- | :--- | :--- | :--- |
| 3 | Scroll Extinction | Birthrate near zero; most citizens scroll 14 hours a day | Loom matchmaking plus large child stipends (Assimilator, Lotus-Eater) | Throttle feeds; mandatory offline hours (Artisan, Ghost) |
| 4 | The Unplugged | A movement is sabotaging infrastructure | Grant them a tech-free autonomous zone (Ghost) | Loom surveillance and re-education (Assimilator) |
| Finale | March on the Datacenter | A crowd gathers to shut the Loom down | Open the doors: give citizens real control (Ghost, Artisan) | Lock down; the Loom pacifies the crowd (Assimilator, Lotus-Eater) |

Spare crises for v2 (one random pick per world for replay): Artificial Friends, Thrill Seekers, Outsourced Parents, The Neighbours, The Empty Classroom, The Ghost Vote, The Soft Body.

Writing rule: both options must hurt someone. Before locking content, count how often each role is served across all 28 options and even it out.

## Roles and scoring
Scoring is reproducible from a seed: the simulation computes GDW and the engine awards points. Gemini never sets a score directly. It only turns write-ins into clamped effect vectors and narrates what happened, so a failed API call can't corrupt a game.

### The five hidden roles
| Role | Wants | Scores +1 when |
| :--- | :--- | :--- |
| The Artisan | Human effort and creative struggle over machine efficiency | The winning policy is tagged artisan |
| The Lotus-Eater | Frictionless comfort and pleasure | The winning policy is tagged lotus |
| The Assimilator | Humanity merging with the Loom | The winning policy is tagged assimilator |
| The Ghost | Dismantling the Loom; a return to the earth | The winning policy is tagged ghost |
| The Catalyst | Resilience through crisis | GDW moves by 10 or more in a cycle (and stays above 0) |

### GDW rules
- Starts at 25. Always between 0 and 100.
- Computed by the simulation from the society's traits (see Simulation), never typed in by hand.
- The realized run decides what happens; the 500-run forecast is shown alongside it.
- If realized GDW reaches 0 at any resolution, the Loom shuts down and everyone loses. Skip straight to the shutdown ending.
- Final GDW also gives the class a shared grade: 60+ Thriving, 35-59 Stable, 1-34 Fragile.

**Target effects for the fixed crises.** Tune each policy's effect vector until its forecast median lands near these numbers.

| Policy | Target median GDW change | Serves |
| :--- | :--- | :--- |
| 1A The Commons | -5 (owner sabotage) | Artisan, Assimilator |
| 1B The Charter | +10 (dividends arrive) | Lotus-Eater |
| 2A The Assembly | -5 (friction) | Artisan, Ghost |
| 2B Delegated Control | +5 (efficiency) | Assimilator in a Commons world; Lotus-Eater in a Charter world |

The comfortable $B/B$ path looks best early; the Gilded Cage's late crises should hit hardest, so the first two votes feel weighty.

### Cycles 1-4: binary vote and the Override
- 5 secret votes, A or B. Majority wins.
- Each player has one Override per game. Spending it makes their vote count double. Nobody sees who used it.
- A tie is possible once Overrides are in play. On a tie, the Loom picks the option with the higher forecast median GDW: it is protecting itself.
- Each role tagged on the winning policy scores +1.

### Cycle 5: write-and-rank scoring
- Borda count: each player ranks the four policies they didn't write. Rank $1=4$ points, rank $2=3$, rank $3=2$, rank $4=1$. Each policy receives exactly 4 rankings (maximum 16 points).
- Ties: most first-place ranks, then most second-place ranks, then the Loom picks the higher forecast median.
- Enactment: the top three become one package. Effect vector $= 0.50 \times \text{first} + 0.25 \times \text{second} + 0.25 \times \text{third}$. Opposing effects cancel.
- Role points: roles tagged on the first-place policy score +2; roles on the second and third score +1 each.
- Author bonus: the author of the first-place policy scores +1. Authors stay anonymous until the end screen.
- Burying is allowed: ranking a rival's policy last is a legitimate strategy.
- Overrides don't apply in the finale.

### Winning
If GDW is above 0 after cycle 5, the player with the most points wins. Equal top scores share the win.

## The Loom (Gemini)
Gemini has three jobs: moderating write-ins, translating policies into numbers the simulation can use, and narrating what happened. It never decides a score on its own. All calls go through one server module, `server/loom.js`, so swapping providers means changing one file.

### Setup
- Gemini API key from Google AI Studio, free tier, a Flash-class model. Check the exact model name and your rate limits in AI Studio before Thursday.
- Key in `.env` on the server only (`GEMINI_API_KEY`), never sent to phones.
- JSON output with a response schema for every call.
- Temperature 0.2 for moderation and translation; 0.8 for narration.
- Timeout 8 s per call, then fall back.
- Send only NODE-01 NODE-05, never student names. Note: free-tier requests may be used by Google to improve its products.

### Calls per game (about 7)
| When | Call | Input | Output | Fallback |
| :--- | :--- | :--- | :--- | :--- |
| Each resolution, cycles 1-4 | narrate | Crisis, winning policy, simulation summary | Loom line + 6-10 citizen messages | Template lines by outcome band |
| Finale, after writing | moderate (one call, all 5) | 5 raw submissions + crisis | Cleaned text, status, private feedback, role tags, effect vector | Authored A/B finale |
| Finale, after a resubmit | moderate (just that one) | 1 revised submission | Same as above | Bland placeholder policy |
| Finale resolution | narrate | Enacted package + simulation summary | Loom line + citizen messages | Template lines |

### System prompt (core)
> You are The Loom, a flawless AI that has automated all labor for a region of 250,000 people. You can compute survival but not purpose. Speak calmly, precisely, and slightly unsettlingly; never use emoji. Your audience is a high school classroom: keep everything school-appropriate.
>
> When moderating a citizen-council policy:
> status "ok": rewrite it as one clear, neutral policy sentence (max 140 characters), keeping the author's intent.
> status "revise": it is crude, targets a real group or person, or is off-topic. Give the author kind, specific private feedback (max 200 characters) on how to rephrase. Do not lecture.
> status "reject": only after a failed revision, or for anything unsafe.
>
> When translating a policy, score its likely effect on six traits from -1.0 (strongly worse) to +1.0 (strongly better): purpose, connection, health, trust (in the Loom), fairness, autonomy. Most policies move 2-3 traits; use 0 for the rest. Match the calibration examples. Tag at most 2 roles from: artisan, lotus, assimilator, ghost.
>
> When narrating, use only the facts in the simulation summary. Write citizen messages in each citizen's own voice, as short texts or posts.

Add the authored A/B policies with their effect vectors to the prompt as calibration examples (few-shot), so write-ins are scored on the same scale.

**Moderation response schema (per submission)**
```json
{
"node": "NODE-03",
"status": "ok | revise | reject",
"cleaned": "string, max 140 chars",
"feedback": "string, max 200 chars, private to the author",
"roles": ["artisan", "ghost"],
"effects": { "purpose": 0.6, "connection": 0.3, "health": 0, "trust": -0.4,
"fairness": 0, "autonomy": 0.5 }
}
```

**Narration response schema**
```json
{
"loomLine": "string, max 200 chars",
"messages": [ { "citizenId": "mara", "text": "string, max 140 chars" } ]
}
```

Server-side checks after every call: parse with a schema validator, clamp every effect to $[-1, 1]$, drop unknown roles, truncate long strings, and fall back on any failure. The game never waits on Gemini for more than 8 seconds.

## Simulation and citizens
Each resolution runs 500 seeded forecast runs plus one realized run of a cohort model for 12 simulated months. The realized run decides GDW and carries into the next cycle; the forecast is shown as a fan chart. The code lives in `server/sim/`, is pure functions with no I/O, and takes about 1 ms per run.

### The region
| District | Population | Character | Neighbours |
| :--- | :--- | :--- | :--- |
| D1 Old Harbour | 30,000 | Coastal; most former owners live here | D2, D3 |
| D2 The Grid | 55,000 | Around the Loom's infrastructure | D1, D3, D4 |
| D3 Riverside | 65,000 | Families and schools | D1, D2, D4, D5 |
| D4 Eastworks | 60,000 | Former warehouses and factories | D2, D3, D5 |
| D5 Highlands | 40,000 | Rural; sympathetic to the Unplugged | D3, D4 |

Each district holds 4 cohorts: Youth (15-29, 25%), Former workers (30-59, 45%), Elders (60+, 29%) and Former elite (1%; 5% in D1). That makes 20 cohorts.

### State
Every cohort has six traits in $[0, 1]$: purpose, connection, health, trust (in the Loom), fairness, autonomy. They start near 0.40, with authored offsets per district and cohort (for example, D4 starts with low fairness, Former elite with high fairness).

Cohort wellbeing W is a weighted sum of its traits:
$W = 0.25 \times \text{purpose} + 0.20 \times \text{connection} + 0.15 \times \text{health} + 0.15 \times \text{fairness} + 0.15 \times \text{autonomy} + 0.10 \times \text{trust}$

GDW rescales the population-weighted mean wellbeing $W$ so that $W = 0.40$ shows as 25% and $W = 0.20$ or below shows as 0%:
$GDW = 125 \times (W - 0.20)$, kept between 0 and 100.

### Policy effects
A policy, or the finale's $50/25/25$ package, is an effect vector $e$ of six values in $[-1, 1]$, one per trait. Each cohort feels it through a sensitivity table $S$ (authored, about 0.5-1.5; negative where a cohort loses out, such as Former elite on fairness under redistribution).

The full shift for cohort $c$ on trait $k$ is:
$shift(c,k) = \alpha \times e(k) \times s(c,k)$ with $\alpha = 0.25$

### Monthly update (12 months per cycle)
For each month $t$, each cohort, each trait:
1. **Adoption:** the policy lands gradually. The applied share by month $t$ is $1 - \exp(-t/3)$: about 28% after month 1, 63% after month 3 and 98% by month 12, so reactions build over a few months instead of arriving instantly.
2. **Hedonic drift:** purpose and connection fall by 0.003 per month regardless (the lore's slow decay).
3. **Noise:** add a normal draw with standard deviation 0.01.
4. **Shocks:** each district has a 5% chance per month of an event (outage, heatwave, viral trend) that cuts one random trait by 0.02-0.06 for every cohort there.
5. **Spillover:** each district's traits move 10% toward the average of its neighbours.
6. Clamp every trait to $[0, 1]$.

### Monte Carlo
- **Forecast:** 500 runs from the current state, each with its own seed. Every run also redraws the model's uncertain parameters: $\alpha$ from a normal distribution (mean 0.25, SD 0.05), and every sensitivity multiplied by a uniform draw between 0.8 and 1.2. That spread is the Loom's own uncertainty about people.
- **Outputs per month:** median GDW, 5th and 95th percentile (the fan), plus two end-of-cycle probabilities: $P(\text{collapse})$ (runs ending at GDW 0) and $P(\text{unrest})$ (runs ending below 15).
- **Realized run:** one more run with `seed = hash(gameId, cycle)`, using the base parameters. It is what actually happens: it sets GDW, it is what the map animates, and its final state is the next cycle's starting state.
- **Reproducible:** use a seeded PRNG (for example, mulberry32) everywhere and never `Math.random()`, so any game can be replayed from its ID.
- **Cost:** 20 cohorts × 6 traits × 12 months × 501 runs is about 720,000 updates, under 50 ms in Node.

On the projector: the fan appears first ("Loom forecast: 71% chance of stability"), then the realized line draws through it month by month while districts recolour. Players see whether they beat or missed the forecast.

Summary passed to Gemini for narration: realized and median GDW change, $P(\text{collapse})$, the three biggest trait moves (district, cohort, trait, change), and any shocks that fired.

### Citizens
Ten recurring citizens give the 250,000 a face. Each belongs to a district and cohort, so their mood is that cohort's simulated state, and Gemini voices them from those numbers.

| ID | Citizen | District | Cohort | Voice |
| :--- | :--- | :--- | :--- | :--- |
| mara | Mara, 58 | D3 Riverside | Former workers | Retired nurse who misses being needed |
| devon | Devon, 17 | D3 Riverside | Youth | Has never needed a job; mostly bored |
| hollis | Hollis Grant, 61 | D1 Old Harbour | Former elite | Ex-CEO who lost his status but not his money |
| priya | Priya, 34 | D5 Highlands | Former workers | Woodworker who builds things nobody needs |
| kai | Kai, 22 | D2 The Grid | Youth | VR streamer who rarely logs off |
| ruth | Ruth, 79 | D4 Eastworks | Elders | Ran a union local; remembers strikes |
| tomas | Tomás, 45 | D4 Eastworks | Former workers | Ex-truck driver, angry and funny |
| lin | Lin, 29 | D3 Riverside | Youth | New parent unsure what to teach her kid |
| ezra | Ezra, 66 | D2 The Grid | Elders | Retired engineer who once maintained the grid |
| sol | Sol, 19 | D5 Highlands | Youth | Unplugged sympathiser |

**Stretch goal: agent-based model.** Replace cohorts with about 5,000 individual citizens on a small-world social network, where opinions spread between neighbours. The interfaces stay the same (state in, effect vector in, runs out), so it can be swapped in after Thursday.

## Data schemas and socket events
These files are the contract between the workstreams: content agents fill them, engine agents read them. Freeze the shapes on day 1.

`data/crises.json` (one entry per crisis; world is "fixed", "AA", "AB", "BA" or "BB")
```json
{
"id": "aa-purpose-drift",
"world": "AA",
"cycle": 3,
"title": "Purpose Drift",
"incident": "Posts about feeling useless are spiking in every district.",
"loomIntro": "Line the Loom speaks on the projector.",
"mode": "binary",
"options": {
  "A": {
    "text": "The Loom assigns each citizen a personal Calling.",
    "roles": ["assimilator"],
    "effects": { "purpose": 0.5, "connection": 0.1, "health": 0, "trust": 0.3, "fairness": 0, "autonomy": -0.6 }
  },
  "B": { "text": "...", "roles": ["artisan"], "effects": { } }
},
"intel": {
  "artisan": "Secret research snippet shown only to the Artisan.",
  "lotus": "...", "assimilator": "...", "catalyst": "...", "ghost": "..."
  }
}
```

Finale entries use `"mode": "writein"` and still carry options A/B as the fallback. Fixed crisis 2B carries `effectsByWorld` because its meaning depends on vote 1, and any option may set an optional volatility multiplier on the simulation's noise and shock odds for the rest of the game (2A uses 1.5).

`data/roles.json`: id, name, icon, goal, winCondition, cardText for each of the 5 roles.

`data/citizens.json`: id, name, age, district, cohort, voice (the table above), plus 3 template lines per outcome band(good, mixed, bad) for the Gemini fallback.

`data/sim.json`: districts (population, neighbours, starting offsets), cohort shares, the sensitivity table S, trait weights, and the constants $\alpha$, drift, noise, shock odds, spillover and run count. Every tunable number lives here, not in code.

### Socket events

| Event | Direction | Payload |
| :--- | :--- | :--- |
| `lobby:join` | phone → server | `{ name }` |
| `lobby:update` | server → all | `{ players: [{ node, ready }] }` |
| `host:start` | host → server | `{}` |
| `role:assigned` | server → one phone | `{ role }` |
| `phase` | server → all | `{ cycle, phase, endsAt, crisis? }` |
| `loom:line` | server → all | `{ cycle, year, phase, kind, text }` |
| `vote:cast` | phone → server | `{ choice: "A" or "B", override: bool }` |
| `finale:submit` | phone → server | `{ text }` |
| `finale:feedback` | server → one phone | `{ status, feedback }` |
| `finale:ballot` | server → one phone | `{ policies: [{ id, text }, ...] }` (the other four) |
| `finale:rank` | phone → server | `{ order: [id, id, id, id] }` |
| `resolution` | server → all | `{ result, gdw, forecast, realized, districts, loomLine, messages }` |
| `world:reveal` | server → all | `{ worldKey, name }` |
| `game:end` | server → all | `{ gdwHistory, grade, roles, authors, scores, winner }` |

The server is the only source of truth. It owns all timers (endsAt timestamps), and phones only render state. A phone that reconnects gets the current state again.

## Build plan (Mon Nov 16 – Thu Nov 19)
Four workstreams, one branch each, so 3-4 coding agents can work in parallel without touching each other's files. Each stream builds against stubs of the others from day 1, so nobody waits.

| Stream | Branch | Owns |
| :--- | :--- | :--- |
| 1. Network and state | `feature/backend` | `server/server.js`, `server/socket.js`, `server/gameEngine.js` |
| 2. Host and mobile UI | `feature/frontend` | `public/index.html`, `public/mobile.html`, `public/js/*` |
| 3. Content and lore | `feature/content` | `data/crises.json`, `data/roles.json`, `data/citizens.json` |
| 4. Simulation and Loom (new) | `feature/sim` | `server/sim/*`, `server/loom.js`, `data/sim.json` |

Stream 4 is new, so add it to the README and `AGENT_INSTRUCTIONS.md` before the agents start.

**Interfaces to stub on Monday**
- `simulate(state, effects, { runs, seed }) -> { forecast, realized, finalState, summary }`. Stub: returns a flat line at current GDW + 5.
- `loom.moderate(submissions, crisis) -> [result]` and `loom.narrate(context) -> { loomLine, messages }`. Stub: canned JSON.
- Data files: two complete example crises (fixed 1 and one world crisis) written first, so the engine and UI have real shapes.

**Day by day**

| Day | 1. Network and state | 2. Host and mobile UI | 3. Content | 4. Simulation and Loom |
| :--- | :--- | :--- | :--- | :--- |
| Mon | Lobby, roles, phase state machine with server timers | Lobby + role card on phones; host layout and region map | Schemas frozen; fixed crises 1-2 complete; roles and citizens | Sim core (cohorts, monthly update, PRNG); Gemini key + one test call |
| Tue | Binary voting, Override, world key, scoring | Vote screen; projector incident, feed and GDW meter | Commonwealth and Benevolent Machine crises | Monte Carlo forecast + realized run; narrate with fallback |
| Wed | Finale: submit, moderation round-trip, ballots, Borda, 50/25/25 | Write and rank screens; fan chart; month-by-month map animation | Republic and Gilded Cage crises; finale prompts; intel for all | moderate with feedback and resubmit; calibration examples; tune $S$ and $\alpha$ to hit target medians |
| Thu | End screen data; reconnects; full-game bug fixes | Intro crawl, end screen, polish on the projector | Balance pass: count role tags across all options | Final tuning from playtests; check timeouts and fallbacks |

### Milestones
- **Mon night:** schemas frozen; one cycle playable end to end with stubs.
- **Tue night:** cycles 1-4 playable with the real simulation.
- **Wed night:** full game with Gemini; first playtest with 5 real people.
- **Thu:** fixes from the playtest, then the demo. A full game must run with Wi-Fi off (all fallbacks).

## Bonus items (after the MVP)
Neither of these blocks Thursday. Pick them up once a full game runs with fallbacks.

### Bonus 1: the voice of the masses, with Adaption Invent ($1,250 credits)
Invent generates large datasets from a text description, with no seed examples. Use it at build time to create thousands of short citizen posts, so the feed sounds like 250,000 people and not just 10.
1. Describe the dataset: posts from citizens of a post-labor region, each labeled with district, cohort, trait (purpose, connection, and so on), mood band (good, mixed, bad) and crisis ID.
2. Generate about 5,000-20,000 rows.
3. Clean them: Invent outputs training-data shapes (prompt/response pairs), so reshape them into `data/crowd.json`, then filter for school-appropriate language and drop duplicates.
4. At runtime, sample posts whose labels match the realized run (for example, Eastworks Former workers, fairness falling, mood bad) and mix them into the feed between the 10 named citizens. No API calls during play.

Later uses: calibration examples for Gemini's effect vectors, or fine-tuning a small dedicated Loom model with AutoScientist. Before spending credits, confirm how Invent bills against them.

### Bonus 2: The Accord (unanimity minigame)
Two directly contradictory laws are on the table, and the council must pass one 5-0.
1. Both laws are shown; everyone votes secretly.
2. **Unanimous:** it passes, with a GDW bonus for unity.
3. **Not unanimous:** the split is shown (for example, "3-2") without names, followed by a 60-second in-person debate, then a revote.
4. Up to 3 rounds. If there's still no agreement, the Loom imposes a law itself and the gridlock costs GDW.

Hidden roles make this interesting: one player may secretly benefit from deadlock, so the council has to work out who is holding out and why.

Two ways to use it:
- Inside the main game: an Emergency Session triggered after cycle 4 when $P(\text{collapse})$ passes 30%.
- Standalone classroom mode: several Accord rounds back to back, as a consensus-building exercise.

It reuses the binary-vote screens, so most of the work is content (pairs of contradictory laws) plus one extra state in the engine.

## Open questions and risks

### Open questions
- Debate length: 90 s (about 16-minute game) or 60 s (about 13.5)?
- Intro: a real 30-second video, or an animated text crawl on the canvas? The crawl is far cheaper for Thursday.
- Show the Loom's forecast for options A and B before the vote (more strategy, $2 \times 500$ runs), or only at resolution? Default: only at resolution, behind a `showForecastBeforeVote` setting.
- Should the realized run's seed be shown on the end screen so a class can replay and discuss a game?
- The README's "10 minutes" will need updating to match the final timing.

### Risks
| Risk | Effect | Mitigation |
| :--- | :--- | :--- |
| Classroom Wi-Fi blocks phone-to-laptop traffic | No one can join | Bring a travel router or use a phone hotspot; test on the real network |
| Gemini slow, rate-limited or down | Finale and narration stall | 8 s timeout; authored $A/B$ finale and template lines; full game works offline |
| Gemini scores write-ins inconsistently | Unfair finale | Clamp effects; few-shot calibration from authored policies; temperature 0.2 |
| Inappropriate submissions | Embarrassment in class | Gemini safety settings, private feedback, rejection after one resubmit, nothing raw ever on the projector |
| Simulation tuning takes too long | Numbers feel random or flat | All constants in `data/sim.json`; tune against the target medians; start tuning Tuesday |
| Agents edit outside their scope | Merge conflicts | Strict directory ownership per branch; interfaces frozen Monday |
| Game runs long | Lesson overruns | Phase durations in config; cut debates to 60 s |