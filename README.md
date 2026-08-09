# KEIRIN FLOW — Official Decision Engine v2

This build preserves the working RaceClock / bell / pacer / bank rendering foundation and replaces scripted line motion with a live tactical interaction layer.

## Core race flow

`race plan -> live position -> threat detection -> rider decision -> block/defend/switch/bante-makuri -> energy/fatigue -> achievable movement -> finish`

## Implemented in this build

- 3-3-3 line structure
- osae-senko / makuri / nakadan-makuri foundations
- front rider resistance when attacked
- bante block when a late makuri approaches
- block pressure that can actually alter the attacking rider's race
- bante-makuri when the front rider has spent too much energy
- dynamic switch after a line is broken
- separate `lineId` and `followTargetNumber`
- drafting / energy / fatigue / outside-lane load
- final sprint foundation
- deterministic 0.5x / 1x / 2x / 3x regression checks
- counterfactual tests proving that changing block/strength/endurance changes the result

## Important

The finish order is never hard-coded.  The same race plan can produce different results when rider capability or interaction settings change.

Run:

```bash
node decision-check.mjs
```
