# Changelog

## Official Decision Engine v2 — 2026-08-09

### Tactical interaction
- Added live threat detection against the controlling line.
- Added leader resistance / defend decision.
- Added bante block with bounded lateral movement and attacker interference.
- Added bante-makuri when the leader is sufficiently depleted.
- Added dynamic switch when an original follow target is genuinely lost.
- Added suppressed self-powered rider behavior: settle behind the tail of a passing line instead of splicing into the line.

### Causal performance
- Added energy, fatigue, effort, drafting and outside-lane load.
- Reduced achievable acceleration/top speed as fatigue grows.
- Kept line affiliation separate from live follow target.

### Verification
- 0.5x / 1x / 2x / 3x complete race checks.
- Block on/off counterfactual changes the resulting order.
- Weak front-rider counterfactual activates bante-makuri.
- Broken-line counterfactual activates switch.
- Strong makuri counterfactual can beat the same block and win.
