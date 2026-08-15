# KEIRIN FLOW CR-0013 FUSION

Base: 2026-08-15 GOOD BASE engine/ui + ScenarioPhaseManager.

## Integrated requirements
- Deterministic fixed simulation quantum: 1/120 s. Playback scale only changes tick consumption.
- No Math.random in production source.
- Same-corridor exclusive bounding slot: 13.5 m minimum longitudinal gap.
- Speed clamped >= 0; distance is monotonic (no reverse flow).
- Cubic smoothstep S-curve lane motion with visible heading tick; original bank scale and rider radius retained.
- LINE_ATTACK leader + locked line followers; followers do not make independent tactical decisions in teacher scenario.
- CR-0013 deterministic post-TSUPPARI reassessment: SAVE_FOR_MAKURI / INSIDE_SWITCH / KEEP_PRESSURE, emitted to Decision Log.
- Existing pacer exit, RESET, speed UI, Tenkai summary and Decision Log preserved.

## Automated check
`node cr0013-fusion-check.mjs`

Expected invariant at 0.5x/1x/2x/3x:
- reverse=false
- minSame=13.50m
- ranking=4-5-2-6-1-3-7-8-9
- LINE_B and LINE_C reassessment deterministic
