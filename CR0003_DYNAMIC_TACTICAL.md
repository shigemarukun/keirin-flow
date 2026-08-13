# CR-0003 Dynamic Tactical Interaction Layer — Foundation

## Purpose
Move KEIRIN FLOW away from coordinate/time-only choreography toward a rider loop:
SENSE -> DECIDE -> ACT -> RE-EVALUATE.

## Added
- tactical-ai.js
  - per-rider sensing: nearest riders, line front, lateral threat, gap, relative speed, energy, race phase
  - tactical modes: FOLLOW / ATTACK / CONTEST / RETREAT / DEFEND / BLOCK / SWITCH / SELF_POWER / RECOVER / FINAL_SPRINT
  - dynamic follower controller with feed-forward + gap correction
  - followers inherit the leader's attack/contest/retreat intent instead of waiting for a large gap
  - 8/9 may detach to SWITCH_TO_SELF_POWER after leader collapse
- engine.js integration
  - TacticalAI command is now the source of action, speed, lane target and follow target
  - attack-follow acceleration/top-speed headroom to prevent the leader from becoming a one-rider missile
  - stronger braking during RETREAT/FADE for a natural line reset
  - history now records tacticalMode
- scenario-b-controller.js
  - second contest is allowed to become a real side-by-side contest before fallback

## CR-0002 preserved
RaceClock timeline remains:
PacerLeaveLine -> Bell -> PacerExit -> FinalLap -> FinalBack -> Finish
ClockOwner remains PACER until physical pacer exit is complete.

## Current migration boundary
Scenario B still supplies the tactical objective/phase. CR-0003 now owns how riders sense and execute it.
The next migration removes rider-number-specific leader objectives from TacticalAI and replaces them with reusable strategy profiles / intents.

## Validation
Run:
node cr0002-timeline-check.mjs
node dynamic-tactical-check.mjs

Validated at 0.5x / 1x / 2x / 3x.
