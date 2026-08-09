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
    SWITCH: 'SWITCH',
    DETACHED: 'DETACHED',
    FINAL_SPRINT: 'FINAL_SPRINT'
});

export const FOLLOW_STATUS = Object.freeze({
    LEADER: 'LEADER',
    ATTACHED: 'ATTACHED',
    STRETCHED: 'STRETCHED',
    DETACHED: 'DETACHED'
});

export const DEFAULT_RIDER_CAPABILITY = Object.freeze({
    formationSpeed: 10.5,
    acceleration: 3.2,
    deceleration: 3.0,
    response: 1.0,
    endurance: 1.0,
    dash: 1.0,
    topSpeed: 21.0,

    // Causal race model:
    // energy is normalized 0..1.  The numbers are simulation coefficients,
    // not claims about physiological watts.
    energyCapacity: 1.0,
    recoveryRate: 0.0018,
    draftSaving: 0.30,
    outerLaneCost: 0.16,
    attackCost: 0.0120,
    defendCost: 0.0130,
    leadCost: 0.0068,
    cruiseCost: 0.0025,
    fatigueStart: 0.55,
    fatigueFloor: 0.56
});
