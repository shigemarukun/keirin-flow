# KEIRIN FLOW — CR-0014 REAL PHYSICS

## Integrated core
- Fixed simulation quantum: 1/120 s accumulator.
- Deterministic execution: no Math.random.
- Same-corridor longitudinal exclusion: 13.5 m minimum, corridor width 9 px.
- Reverse motion prohibited (`speed >= 0`, `distance` monotonic).
- Cubic smoothstep S-curve lane changes with visual lean/heading.
- Outer-lane load capped at 6.5% during ATTACK / LINE_ATTACK.
- Bante block resistance resolved from scenario line roles, not fixed car numbers.
- Scenario phase leader/block lookups resolve through LineManager.
- Existing CR-0013 tactical reassessment and Decision Log retained.
- Existing reset, pacer exit, UI scale, line-follow and final-order teacher scenario retained.

## Regression result
All playback scales 0.5x / 1x / 2x / 3x:
- Ranking: 4-5-2-6-1-3-7-8-9
- Reverse: 0
- Exact overlap: 0
- Minimum same-corridor longitudinal gap: 13.500 m
- Math.random: 0 occurrences
- JS syntax check: PASS

## Notes
The deterministic test validates simulation-state invariants and final order in Node. Browser visual quality still depends on the browser/canvas renderer; the renderer remains state-read-only and does not write physics state.
