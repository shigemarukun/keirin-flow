import { TACTIC } from './tactics.js';

// Demonstration plan for the decision engine.
// It describes intentions, not a finishing order.
// 7-line takes control first, 4-line attacks from middle, then 1-line attacks
// the 4-line late.  The engine must decide resistance, block, switch and final
// sprint from the live situation.
export const DEFAULT_RACE_PLAN = Object.freeze({
    1: {
        tactic: TACTIC.MAKURI,
        triggerRemaining: 205,
        attackLane: 29,
        attackSpeed: 20.0,
        targetLineId: 1,
        settleAfterPassMeters: 6,
        capability: { dash: 1.10, topSpeed: 22.1, acceleration: 3.7, endurance: 0.98 }
    },
    2: {
        tactic: TACTIC.MARK,
        followNumber: 1,
        capability: { dash: 1.02, topSpeed: 21.8, acceleration: 3.7, blockSkill: 0.95 }
    },
    3: { tactic: TACTIC.MARK, followNumber: 2, capability: { topSpeed: 21.2, acceleration: 3.5 } },

    4: {
        tactic: TACTIC.NAKADAN_MAKURI,
        preFollowNumber: 9,
        preFollowTriggerRemaining: 620,
        triggerRemaining: 365,
        attackLane: 28,
        attackSpeed: 18.5,
        targetLineId: 2,
        settleAfterPassMeters: 6,
        defendOnThreat: true,
        defendSpeed: 18.0,
        capability: { endurance: 0.92, topSpeed: 21.3, acceleration: 3.4 }
    },
    5: {
        tactic: TACTIC.MARK,
        followNumber: 4,
        blockEnabled: true,
        banteMakuriEnabled: true,
        capability: { blockSkill: 1.16, dash: 1.04, topSpeed: 22.0, acceleration: 3.8, endurance: 1.03 }
    },
    6: { tactic: TACTIC.MARK, followNumber: 5, capability: { topSpeed: 21.2, acceleration: 3.5 } },

    7: {
        tactic: TACTIC.OSAE_SENKO,
        triggerRemaining: 640,
        settleRemaining: 555,
        attackLane: 26,
        attackSpeed: 16.0,
        leadSpeed: 13.0,
        defendOnThreat: true,
        defendSpeed: 16.4,
        capability: { endurance: 0.84, topSpeed: 20.2, acceleration: 3.2 }
    },
    8: {
        tactic: TACTIC.MARK,
        followNumber: 7,
        blockEnabled: true,
        banteMakuriEnabled: false,
        capability: { blockSkill: 1.02, topSpeed: 21.4, acceleration: 3.6 }
    },
    9: { tactic: TACTIC.MARK, followNumber: 8, capability: { topSpeed: 20.9, acceleration: 3.4 } }
});
