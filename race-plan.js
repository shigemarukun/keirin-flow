import { TACTIC } from './tactics.js';

// BASE SCENARIO A — reference race for movement calibration.
// This file fixes tactical intentions and trigger windows only.
// It never specifies the finishing order directly.
//
// Expected story:
// 1-2-3 / 4-5-6 / 7-8-9 -> 7-line moves outside to cut the pacer.
// 1 does not tsuppari. 4-line rises behind 7-line.
// Final lap: 7-8-9 / 4-5-6 / 1-2-3.
// 1 attacks; 7 resists; 8 blocks; 1-line loses momentum around half-lap.
// 4, having conserved energy in the middle, attacks and the target validation result is 4-5-8.
export const DEFAULT_RACE_PLAN = Object.freeze({
    1: {
        tactic: TACTIC.MAKURI,
        preFollowNumber: 6,
        preFollowTriggerRemaining: 560,
        yieldFromRemaining: 610,
        yieldUntilTargetAhead: 6,
        yieldSpeed: 9.3,
        triggerRemaining: 315,
        attackLane: 34,
        attackSpeed: 20.8,
        targetLineId: 2,
        settleAfterPassMeters: 7,
        capability: { dash: 1.08, topSpeed: 21.4, acceleration: 3.75, endurance: 0.58, fatigueStart: 0.62, fatigueFloor: 0.45 }
    },
    2: { tactic: TACTIC.MARK, followNumber: 1, capability: { topSpeed: 21.5, acceleration: 3.65, endurance: 0.96 } },
    3: { tactic: TACTIC.MARK, followNumber: 2, capability: { topSpeed: 21.0, acceleration: 3.45, endurance: 0.94 } },

    4: {
        tactic: TACTIC.NAKADAN_MAKURI,
        preFollowNumber: 9,
        preFollowTriggerRemaining: 635,
        outsideUntilLineClearsNumber: 1,
        triggerRemaining: 210,
        attackLane: 46,
        attackSpeed: 22.2,
        leadSpeed: 21.6,
        targetLineId: 2,
        settleAfterPassMeters: 7,
        capability: { dash: 1.20, topSpeed: 24.2, acceleration: 4.45, endurance: 1.16 }
    },
    5: { tactic: TACTIC.MARK, followNumber: 4, blockEnabled: false, banteMakuriEnabled: false, capability: { dash: 1.12, topSpeed: 24.0, acceleration: 4.45, endurance: 1.16 } },
    6: { tactic: TACTIC.MARK, followNumber: 5, capability: { topSpeed: 21.3, acceleration: 3.5, endurance: 1.00 } },

    7: {
        tactic: TACTIC.OSAE_SENKO,
        targetLineId: 0,
        settleAfterPassMeters: 5,
        triggerRemaining: 655,
        settleRemaining: 0,
        attackLane: 34,
        attackSpeed: 20.0,
        leadSpeed: 15.0,
        defendOnThreat: true,
        defendSpeed: 18.0,
        capability: { endurance: 0.78, topSpeed: 21.2, acceleration: 3.75 }
    },
    8: {
        tactic: TACTIC.MARK,
        followNumber: 7,
        blockEnabled: true,
        banteMakuriEnabled: false,
        allowIndependentSprint: true,
        maxBlockAttempts: 1,
        capability: { blockSkill: 1.18, topSpeed: 20.6, acceleration: 3.55, endurance: 1.12 }
    },
    9: { tactic: TACTIC.MARK, followNumber: 8, capability: { topSpeed: 20.8, acceleration: 3.35, endurance: 0.98 } }
});
