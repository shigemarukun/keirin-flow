// KEIRIN FLOW — Base Scenario B rider calibration.
// This is a reference scenario, not a hard-coded finish-order table.
// The engine still determines finish order from distance/speed/energy.

export const DEFAULT_RACE_PLAN = Object.freeze({
    1: {
        role: 'TSUPPARI_LEADER',
        topSpeed: 22.6, acceleration: 3.9, endurance: 1.18,
        firstDefenseSpeed: 18.0,
        secondDefenseSpeed: 19.1,
        finalHoldSpeed: 19.4
    },
    2: {
        role: 'BANTE_DEFENDER',
        topSpeed: 22.5, acceleration: 4.0, endurance: 1.16,
        blockSkill: 1.25,
        finalSpeed: 20.2
    },
    3: {
        role: 'THIRD_MARK',
        topSpeed: 21.3, acceleration: 3.45, endurance: 1.04,
        finalSpeed: 18.8
    },

    4: {
        role: 'MIDDLE_MAKURI',
        topSpeed: 22.2, acceleration: 4.05, endurance: 1.12,
        makuriSpeed: 21.4
    },
    5: {
        role: 'BLOCK_DIVE',
        topSpeed: 24.2, acceleration: 4.60, endurance: 1.18,
        diveSpeed: 23.6
    },
    6: {
        role: 'THIRD_MARK',
        topSpeed: 22.6, acceleration: 3.95, endurance: 1.10,
        finalSpeed: 20.7
    },

    7: {
        role: 'DOUBLE_ATTACK',
        topSpeed: 21.0, acceleration: 3.7, endurance: 0.66,
        firstAttackSpeed: 17.5,
        retreatSpeed: 9.2,
        secondAttackSpeed: 19.0,
        collapseSpeed: 11.4
    },
    8: {
        role: 'MARK_7',
        topSpeed: 20.5, acceleration: 3.35, endurance: 0.90,
        finalSpeed: 17.2
    },
    9: {
        role: 'MARK_8',
        topSpeed: 22.0, acceleration: 3.85, endurance: 0.98,
        finalSpeed: 20.4
    }
});
