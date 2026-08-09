export const TACTIC = Object.freeze({
    HOLD: 'HOLD',
    MARK: 'MARK',
    OSAE_SENKO: 'OSAE_SENKO',
    TSUPPARI: 'TSUPPARI',
    KAMASHI: 'KAMASHI',
    MAKURI: 'MAKURI',
    NAKADAN_MAKURI: 'NAKADAN_MAKURI',
    BANTE_MAKURI: 'BANTE_MAKURI',
    OIKOMI: 'OIKOMI',
    SWITCH: 'SWITCH',
    SOLO: 'SOLO'
});

export const ACTION = Object.freeze({
    FORMATION: 'FORMATION',
    FOLLOW: 'FOLLOW',
    MOVE_UP: 'MOVE_UP',
    ATTACK: 'ATTACK',
    LEAD: 'LEAD',
    DEFEND: 'DEFEND',
    BLOCK: 'BLOCK',
    BANTE_MAKURI: 'BANTE_MAKURI',
    SWITCH: 'SWITCH',
    DETACHED: 'DETACHED',
    FINAL_SPRINT: 'FINAL_SPRINT'
});

export const FOLLOW_STATUS = Object.freeze({
    LEADER: 'LEADER',
    ATTACHED: 'ATTACHED',
    STRETCHED: 'STRETCHED',
    DETACHED: 'DETACHED',
    SWITCHED: 'SWITCHED'
});

// These are simulator coefficients. They are intentionally separated from
// tactics so real rider data can replace them later without rewriting race logic.
export const DEFAULT_RIDER_CAPABILITY = Object.freeze({
    formationSpeed: 10.5,
    acceleration: 3.2,
    deceleration: 3.0,
    response: 1.0,
    endurance: 1.0,
    dash: 1.0,
    topSpeed: 21.0,
    energyCapacity: 1.0,
    recoveryRate: 0.0014,
    draftSaving: 0.28,
    outerLaneCost: 0.15,
    fatigueStart: 0.52,
    fatigueFloor: 0.54,
    blockSkill: 1.0,
    switchSkill: 1.0,
    positioning: 1.0
});
