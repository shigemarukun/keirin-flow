import { TACTIC } from './tactics.js';

// Validation scenario only.  The engine consumes a data plan rather than
// hard-coding rider numbers into movement logic.  AI/user editing can later
// replace this object without changing the movement engine.
export const DEFAULT_RACE_PLAN = Object.freeze({
    1: {
        tactic: TACTIC.MAKURI,
        triggerRemaining: 360,
        attackTargetNumber: 7,
        attackLane: 28,
        attackSpeed: 18.3,
        settleAfterPassMeters: 7
    },
    2: { tactic: TACTIC.MARK, followNumber: 1 },
    3: { tactic: TACTIC.MARK, followNumber: 2 },

    4: {
        tactic: TACTIC.NAKADAN_MAKURI,
        preFollowNumber: 9,
        preFollowTriggerRemaining: 640,
        triggerRemaining: 120,
        attackLane: 30,
        attackSpeed: 20.6
    },
    5: { tactic: TACTIC.MARK, followNumber: 4 },
    6: { tactic: TACTIC.MARK, followNumber: 5 },

    7: {
        tactic: TACTIC.OSAE_SENKO,
        triggerRemaining: 640,
        settleRemaining: 560,
        attackLane: 26,
        attackSpeed: 16.2,
        leadSpeed: 13.1,
        // resistance phase against the later 1-line makuri
        defendAgainstNumber: 1,
        defendFromRemaining: 360,
        defendUntilRemaining: 200,
        defendSpeed: 17.1
    },
    8: { tactic: TACTIC.MARK, followNumber: 7 },
    9: { tactic: TACTIC.MARK, followNumber: 8 }
});
