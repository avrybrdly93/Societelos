# TASK-740 — Catalyst trigger-rate calibration

**Date:** 2026-11-21  
**Seed basis:** 20261119, with 1,000 independently seeded game paths  
**Current model:** `data/sim.json` wellness model; current `data/crises.json`

The check selected a crisis-tree root, randomized each A/B vote, and ran up to
five cycles with the authored crisis and finale effects. Each cycle's realized
GDW change was passed through the production `catalystScores()` rule, which
counts an absolute swing of at least 10 points when the Loom remains above 0.

| Measure | Result |
| :--- | ---: |
| Mean Catalyst triggers per game | **1.665** |
| Target range | 1.5–2.5 |
| Games with at least one trigger | 787 / 1,000 |
| Games ending in collapse | 104 / 1,000 |
| Triggers by cycle | 642, 198, 191, 364, 270 |

The measured mean is inside the requested range, so no `alpha` or trait-weight
tuning was needed for TASK-740.
