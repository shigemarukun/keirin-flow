# KEIRIN FLOW — Race Tactics Architecture v1

## Core rule
Line affiliation and movement are separate concepts.

- `lineId / lineOrder`: who the rider belongs with before the race.
- `followTargetNumber`: who the rider is actually following now.
- `tactic`: the pre-race intention chosen by AI or user.
- `action`: the rider's current in-race behavior selected from the tactic and race state.

## Tactics already represented
- HOLD
- MARK
- OSAE_SENKO
- TSUPPARI
- KAMASHI
- MAKURI
- NAKADAN_MAKURI
- BANTE_MAKURI
- OIKOMI
- SWITCH
- SOLO

## Runtime actions
- FORMATION
- FOLLOW
- MOVE_UP
- ATTACK
- LEAD
- DEFEND
- SWITCH
- DETACHED
- FINAL_SPRINT

## Follow states
- LEADER
- ATTACHED
- STRETCHED
- DETACHED

## Why this architecture exists
A line is not a rigid 2/3/4-car object.  The leader initiates a move, followers react individually, gaps can stretch, a rider can detach, and a detached rider can switch to another viable wheel without changing his original line affiliation.

## Current validation scenario
The existing 3-3-3 scenario is expressed as data in `race-plan.js`, not as movement rules:
- 7: OSAE_SENKO
- 8,9: MARK
- 4: follows 9 first, then NAKADAN_MAKURI
- 5,6: MARK
- 1: MAKURI
- 2,3: MARK

Changing tactics should eventually require editing plan data, not rewriting the movement engine.
