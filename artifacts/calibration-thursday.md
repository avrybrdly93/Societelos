# Calibration report: Thursday (generated 2026-11-18 01:43 GMT, commit eafc9fd)

## Findings

- Fixed crises hit their targets: 1A -4.9 (target -5), 1B +10.2 (+10), 2A -4.8 (-5), 2B +5.2 / +4.8 (+5), all within 1.5 GDW.
- Every crisis forecast is valid (13 months, bands ordered, inside 0-100).
- Random-play final bands are off target: collapse 0% (target 15-25%), fragile 71% (20-30%), stable 27% (35-45%), thriving 2% (15-25%). See TASK-544 / TASK-562.
- With authored options only, even the worst choice every cycle never reaches GDW 0; the Shutdown ending needs a strongly negative write-in finale package (server/sim/test/collapse.test.js). See TASK-739.
- Catalyst scores 0.72 cycles per game under random play (target 1.5-2.5). See TASK-740 / TASK-741.
- Role tags: only World AB is even. Fixed ghost 1 vs 2; AA lotus/ghost 2 vs 3; BA lotus 3 vs 2; BB assimilator/ghost 3 vs 2; global 12/12/13/11 (artisan/lotus/assimilator/ghost). The tags match the spec's crisis tables, so evening them out is a design decision (TASK-701..707).
- 17 of 28 option texts are 120+ characters (TASK-720); the projector layout fits them (TASK-677).

## Fixed crises (npm run calibrate)
```
Calibration: 500 forecast runs per option, seed 20261119, start GDW 25.0
option            target  median  realized  name
1A                  -5.0    -4.9    -3.5    The Commons
1B                 +10.0   +10.2   +11.6    The Charter
2A                  -5.0    -4.8    -3.3    The Assembly
2B (after 1A)       +5.0    +5.2    +6.5    Delegated Control
2B (after 1B)       +5.0    +4.8    +6.1    Delegated Control

Two-cycle paths (median GDW: start -> after cycle 1 -> after cycle 2):
  AA: 25.0 -> 20.1 -> 17.6
  AB: 25.0 -> 20.1 -> 26.6
  BA: 25.0 -> 35.2 -> 31.9
  BB: 25.0 -> 35.2 -> 41.3
```

## Every crisis option (npm run calibrate:crises)
```
Every crisis option forecast from the state it is played in (500 runs, seed 20261119)
  fixed-1-ownership      fixed c1        A  median   -4.9  p5-95   +2.4  ok
  fixed-1-ownership      fixed c1        B  median  +10.2  p5-95   +8.4  ok
  fixed-2-offswitch      fixed c2        A  median   -4.8  p5-95   +2.5  ok
  fixed-2-offswitch      fixed c2        B  median   +5.2  p5-95   +5.3  ok
  aa-purpose-drift       AA    c3        A  median   +0.6  p5-95   +3.3  ok
  aa-purpose-drift       AA    c3        B  median   +5.4  p5-95   +5.8  ok
  aa-lost-knowledge      AA    c4        A  median   +8.3  p5-95   +7.8  ok
  aa-lost-knowledge      AA    c4        B  median   -7.0  p5-95   +3.9  ok
  aa-fake-struggle       AA    c5 finale A  median   +0.2  p5-95   +3.4  ok
  aa-fake-struggle       AA    c5 finale B  median   -1.8  p5-95   +2.8  ok
  ab-the-pods            AB    c3        A  median   +4.4  p5-95   +5.0  ok
  ab-the-pods            AB    c3        B  median   -0.0  p5-95   +2.5  ok
  ab-mood-dial           AB    c4        A  median   -5.4  p5-95   +2.9  ok
  ab-mood-dial           AB    c4        B  median   +6.6  p5-95   +6.2  ok
  ab-merge-offer         AB    c5 finale A  median   -4.3  p5-95   +2.3  ok
  ab-merge-offer         AB    c5 finale B  median   +1.1  p5-95   +2.9  ok
  ba-shadow-elite        BA    c3        A  median   +6.1  p5-95   +6.1  ok
  ba-shadow-elite        BA    c3        B  median   -5.4  p5-95   +3.3  ok
  ba-status-wars         BA    c4        A  median   +0.7  p5-95   +3.4  ok
  ba-status-wars         BA    c4        B  median  +11.6  p5-95   +9.6  ok
  ba-vote-to-seize       BA    c5 finale A  median   +1.1  p5-95   +3.6  ok
  ba-vote-to-seize       BA    c5 finale B  median   -6.0  p5-95   +3.6  ok
  bb-scroll-extinction   BB    c3        A  median   +1.1  p5-95   +3.0  ok
  bb-scroll-extinction   BB    c3        B  median   +7.9  p5-95   +7.1  ok
  bb-the-unplugged       BB    c4        A  median   +9.3  p5-95   +8.0  ok
  bb-the-unplugged       BB    c4        B  median  -17.3  p5-95   +9.7  ok
  bb-march-datacenter    BB    c5 finale A  median   +6.9  p5-95   +6.4  ok
  bb-march-datacenter    BB    c5 finale B  median  -17.0  p5-95   +9.6  ok
  aa-robot-art           AA    c5        A  median   +3.5  p5-95   +4.6  ok
  aa-robot-art           AA    c5        B  median   -1.2  p5-95   +2.8  ok
  aa-curriculum-revolt   AA    c6        A  median   +6.0  p5-95   +6.2  ok
  aa-curriculum-revolt   AA    c6        B  median   -2.2  p5-95   +2.5  ok
  ab-curated-bonds       AB    c5        A  median   -0.3  p5-95   +2.4  ok
  ab-curated-bonds       AB    c5        B  median   +3.2  p5-95   +4.3  ok
  ab-memory-edit         AB    c6        A  median   +3.8  p5-95   +4.3  ok
  ab-memory-edit         AB    c6        B  median   -2.8  p5-95   +2.1  ok
  ba-private-security    BA    c5        A  median   +3.0  p5-95   +4.4  ok
  ba-private-security    BA    c5        B  median   -6.4  p5-95   +3.8  ok
  ba-media-monopoly      BA    c6        A  median   +7.5  p5-95   +7.0  ok
  ba-media-monopoly      BA    c6        B  median   -6.1  p5-95   +3.6  ok
  bb-luxury-lottery      BB    c5        A  median   +8.2  p5-95   +7.3  ok
  bb-luxury-lottery      BB    c5        B  median   -8.5  p5-95   +4.6  ok
  bb-biometric-tollways  BB    c6        A  median   +8.1  p5-95   +7.2  ok
  bb-biometric-tollways  BB    c6        B  median  -13.2  p5-95   +7.5  ok
22 crises, 44 options: all forecasts valid
```

## 1,000-game sweep (npm run calibrate:sweep)
```
Trajectory sweep: 1000 games, random A/B every cycle (finale: authored A/B), seed 20261119
  Collapse (0)         0    0.0%   target 15-25%  OFF
  Fragile (1-34)     711   71.1%   target 20-30%  OFF
  Stable (35-59)     265   26.5%   target 35-45%  OFF
  Thriving (60+)      24    2.4%   target 15-25%  OFF
  final GDW: median 29.9, p10 12.5, p90 42.1
```

## Catalyst trigger rate (npm run calibrate:catalyst)
```
Catalyst trigger rate: 1000 games, random A/B votes (finale: authored A/B), seed 20261119
  mean 0.72 scoring cycles per game   target 1.5-2.5  OFF
  by cycle: C1 33%  C2 0%  C3 0%  C4 27%  C5 12%
  games by count: 0x 559, 1x 206, 2x 195, 3x 40
```

## Role tag balance matrix (npm run content:report)
```
Role tag balance: 14 core crises, 28 authored options
                   artisan        lotus  assimilator        ghost
  fixed                  2            2            2            1   UNEVEN
  AA                     3            2            3            2   UNEVEN
  AB                     3            3            3            3   even
  BA                     2            3            2            2   UNEVEN
  BB                     2            2            3            3   UNEVEN
  total                 12           12           13           11   UNEVEN

Tags scorable in Cycles 1-2, per path (1st letter = Cycle 1 vote):
  path AA                2            0            1            1   no early tag for lotus
  path AB                1            0            2            0   no early tag for lotus, ghost
  path BA                1            1            0            1   no early tag for assimilator
  path BB                0            2            0            0   no early tag for artisan, assimilator, ghost

Modes: 10 binary, 4 write-in finales (4 with A/B fallbacks)
Both options hurt someone: yes, all options

Lengths:
  Intel drops                 70 strings, longest 172  (limit <=180) ok
  Option text                 28 strings, longest 237  (limit <120) 17 OVER
  Citizen fallback lines      30 strings, longest 112  (limit <=140) ok
  Loom resolution lines       60 strings, longest 126  (limit <=200) ok
    option text fixed-1-ownership A: 206 chars
    option text fixed-1-ownership B: 187 chars
    option text fixed-2-offswitch A: 237 chars
    option text fixed-2-offswitch B: 235 chars
    option text aa-purpose-drift A: 122 chars
    option text aa-purpose-drift B: 128 chars
    option text aa-lost-knowledge A: 156 chars
    option text aa-lost-knowledge B: 137 chars
    option text aa-fake-struggle A: 129 chars
    option text aa-fake-struggle B: 146 chars
    option text ab-the-pods A: 156 chars
    option text ab-the-pods B: 153 chars
    option text ab-mood-dial A: 128 chars
    option text ab-mood-dial B: 139 chars
    option text ab-merge-offer A: 142 chars
    option text bb-scroll-extinction A: 130 chars
    option text bb-scroll-extinction B: 127 chars
```
