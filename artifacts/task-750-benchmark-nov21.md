# TASK-750 — Low-power simulation benchmark

**Date:** 2026-11-21  
**CPU:** 11th Gen Intel Core i7-11370H @ 3.30 GHz  
**Node.js:** v24.22.3  
**Command:** `node server/sim/test/bench.js` (the repo's `bench:sim` entry point)

The benchmark runs one 500-forecast + 1 realized simulation cycle and checks
that it completes in under 50 ms.

| Run | Realized run | Forecast run | Full cycle | Result |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 0.184 ms | 0.072 ms | 36.327 ms | Pass |
| 2 | 0.176 ms | 0.071 ms | 36.211 ms | Pass |
| 3 | 0.176 ms | 0.071 ms | 38.080 ms | Pass |

All three full-cycle measurements were below the 50 ms target on this laptop.
An earlier session record reported 91.7 ms on the same CPU; that result did
not reproduce in these runs. Recheck on the demo laptop if its power mode or
runtime differs.
