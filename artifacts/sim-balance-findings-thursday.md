# Simulation balance findings (Thursday, TASK-739 / TASK-740 / TASK-741)

Measured on branch `claude/tasks-2026-11-18-0047` with the shipped `data/sim.json` and `data/crises.json`
(seed 20261119, 1000 games, every A/B choice random, finale = authored A/B fallback).

## Results

| Check | Target | Measured | Status |
| :--- | :--- | :--- | :--- |
| Fixed crisis medians (TASK-737) | -5 / +10 / -5 / +5 +/- 1.5 | -4.9 / +10.2 / -4.8 / +5.2, +4.8 | pass |
| No forced collapse in Cycles 3-4 (TASK-738) | P(collapse) < 100% | 0% on all 24 paths | pass |
| Reckless play pushes P(collapse) > 30% (TASK-739) | > 30% | **0%**: greedy worst choice every cycle bottoms out at median GDW 10.3 (AA) / 12.5 (BB) | **fail** |
| Shutdown ending reachable (TASK-739) | possible | **0 collapses in 1000 random games** (`npm run calibrate:sweep`) | **fail** |
| Catalyst scoring cycles per game (TASK-740) | 1.5-2.5 | **0.69** (56% of games: 0; 22%: 1; 17%: 2; 4%: 3) | **fail** |

Catalyst hits by cycle: C1 315, C2 0, C3 1, C4 263, C5 112. Cycle 1's +10 Charter is the main source;
Cycles 2-3 almost never swing 10 points.

Random-play final GDW: Collapse 0%, Fragile 71%, Stable 27%, Thriving 2% (targets 15-25 / 20-30 / 35-45 / 15-25).

## Why tuning noise does not fix it

An in-memory sweep (no data changed) over `noiseSD` 0.01-0.04 and `alphaSD` 0.05-0.15 left the Catalyst rate
at 0.69-0.73 per game and collapse at 0%, while fixed medians stayed within 0.5 of target. GDW averages 20
cohorts over 12 months, so independent cohort noise cancels out; realized swings come almost entirely from the
effect vectors, which are calibrated to move GDW by about 5-10 points per cycle. Shocks only subtract
(`shockMin`/`shockMax` 0.02-0.06, 5% per district per month) and hit one district at a time.

## Options (need a design decision before the demo)

1. **Lower the Catalyst threshold** to a swing of 6-7 GDW (engine constant `CATALYST_SWING`): smallest change,
   no balance side effects on the other roles or the medians. Re-measure with the script used here.
2. **Scale up world-crisis effect vectors** (Cycles 3-5 only; the fixed crises keep their calibrated targets) so
   more choices swing 10+ points and reckless paths can reach 0.
3. **Region-wide correlated shocks** (one event hitting all 5 districts) when volatility is high, giving the
   Shutdown ending a real path without moving medians much.
4. **Accept the gentle sim for Thursday** and tell the class that the Shutdown is a rare ending.

Option 1 plus a teacher note is the lowest-risk choice for a demo tomorrow; options 2-3 need a fresh
calibration pass and ideally a playtest.

## simulate() speed on slower CPUs (TASK-750, not checked off)

`npm run bench:sim` on the cloud runner (Xeon 2.1 GHz): 501 runs in **39.6 ms** (target < 50 ms, pass).
Emulating slower CPUs by pinning the bench to one core shared with busy processes:

| Emulated speed | simulate (500 + 1 runs) |
| :--- | :--- |
| 1x (this runner) | 39.6 ms |
| ~2x slower | 76.3 ms |
| ~3x slower | 114.1 ms |

A low-power classroom laptop will likely miss the 50 ms target. Impact is small: `simulate()` runs once per
resolution, so the server pauses ~0.1 s at most, which players will not see. 80% of the time is the Gaussian noise draws
(log/sqrt/cos/sin per trait per month); making them cheaper would change the random stream and break
bit-for-bit seed replay, so I left it alone the night before the demo. If needed, `constants.forecastRuns` (500) can
be lowered (e.g. 300) at the cost of a noisier forecast fan; the realized run is unaffected.
