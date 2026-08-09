# KEIRIN FLOW — Official Decision Model v2

This version changes the simulator from a scripted animation toward a situational race engine.

## Core causal chain

`line / tactic -> live position -> threat detection -> rider decision -> interaction -> energy -> achievable speed -> pass / block / switch / bante-makuri -> finish`

## Official KEIRIN concepts represented

- line / mark
- osae-senko
- tsuppari
- kamashi
- makuri
- bante role
- block
- widening / following gap
- switching after another line passes
- bante-makuri
- final sprint / oikomi foundation
- mogakiai / resistance foundation

## Important design rule

A rider's `lineId` is affiliation. `followTargetNumber` is the rider actually being followed now. They are not the same concept.

## What is situational now

When a late makuri reaches a controlling line:

1. the front rider can defend if the plan allows and energy remains;
2. the second rider can block the attacker if in range;
3. the attacker can still get around the block if speed/position permit;
4. if the leader fades, the second rider can bante-makuri;
5. if the original line is passed, followers can switch to another live target;
6. final order is recorded only from finish-line crossing.

## Rule constraints

The code does not give riders unlimited lateral motion. Blocking is bounded and temporary. This is a simulation-safe foundation for the official prohibitions on dangerous cross-cutting, pushing, forcing outward and inside overtaking. Exact adjudication geometry is deliberately left for a later rules-calibration layer.
