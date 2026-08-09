# KEIRIN FLOW — Causal Race Engine v1

## Why this change exists

The simulator must not decide a finishing order and then animate riders into that order.

The direction is now:

`strategy -> decision -> effort -> energy/fatigue -> achievable movement -> gaps/switches -> finish order`

## Preserved foundation

- RaceClock and event order
- PACER -> LEADER clock handoff
- Bell
- pacer exit
- 400m geometry / UI
- dynamic follow target architecture
- line affiliation
- existing tactics vocabulary

## New rider state

Each rider now carries:

- `energy` (0..capacity)
- `fatigue`
- `effort`
- `drafting`
- `load`

These values are simulation state, not physiological watt measurements.

## Causal rules v1

1. ATTACK / MOVE_UP / DEFEND / LEAD consume different amounts of energy.
2. Higher requested speed and acceleration increase load.
3. Riding wide adds load.
4. A usable following pocket reduces load.
5. Low energy reduces effective top speed and acceleration.
6. Race plans request tactics; they no longer guarantee the finishing order.
7. Finish order remains the actual order riders cross `RACE_DISTANCE`.

## Deliberately NOT added yet

- real rider parameter calibration
- probabilistic tactical decisions
- contact/blocking physics
- venue-specific bank physics
- automatic bante-makuri / oikomi decision policies

Those belong on top of this causal layer rather than being hard-coded animations.
