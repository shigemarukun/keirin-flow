export const ROLE = Object.freeze({
  LEADER: 'LEADER',
  BANTE: 'BANTE',
  THIRD: 'THIRD',
  LINE_MEMBER: 'LINE_MEMBER',
  SOLO: 'SOLO'
});

export const MINDSET = Object.freeze({
  TSUPPARI: 'TSUPPARI',
  YIELD_AND_ROLL: 'YIELD_AND_ROLL',
  CONTAIN: 'CONTAIN'
});


export const RACE_INTENT = Object.freeze({
  HOLD_FRONT: 'HOLD_FRONT',
  CUT_PACER: 'CUT_PACER',
  TAKE_FRONT: 'TAKE_FRONT',
  YIELD_FRONT: 'YIELD_FRONT',
  RETAKE_LATER: 'RETAKE_LATER',
  HOLD_MIDDLE: 'HOLD_MIDDLE',
  SAVE_FOR_MAKURI: 'SAVE_FOR_MAKURI'
});

export const PROTOCOL_STATE = Object.freeze({
  FORMATION: 'FORMATION',
  RED_BOARD_APPROACH: 'RED_BOARD_APPROACH',
  PACER_CUT_SELECTION: 'PACER_CUT_SELECTION',
  PACER_CUT_APPROACH: 'PACER_CUT_APPROACH',
  FRONT_RESPONSE: 'FRONT_RESPONSE',
  FRONT_CONTEST: 'FRONT_CONTEST',
  PACER_CUT_SUCCESS: 'PACER_CUT_SUCCESS',
  PACER_CUT_REJECTED: 'PACER_CUT_REJECTED',
  BELL_FORMATION: 'BELL_FORMATION',
  OPEN_RACE: 'OPEN_RACE'
});


export const SOLO_MINDSET = Object.freeze({
  ATTACH_AND_STRIKE: 'ATTACH_AND_STRIKE',
  SAVE_AND_SPRINT: 'SAVE_AND_SPRINT',
  FLOW_RIDE: 'FLOW_RIDE'
});

export const LINE_FOLLOW_MODE = Object.freeze({
  LOCKED_FOLLOW: 'LOCKED_FOLLOW',
  SETTLING: 'SETTLING',
  FREE: 'FREE'
});

export const TRACK_LANE = Object.freeze({
  INNER: -18,
  ATTACK: 30,
  OUTSIDE: 38
});


export const SCENARIO_PHASE = Object.freeze({
  PACER_CUT: 'PHASE_1_PACER_CUT',
  TSUPPARI_RESET: 'PHASE_2_TSUPPARI_RESET',
  SECOND_ATTACK: 'PHASE_3_SECOND_ATTACK',
  MAKURI: 'PHASE_4_MAKURI',
  FINISH: 'PHASE_5_FINISH'
});

export const SCENARIO_TYPE = Object.freeze({
  TSUPPARI_MAKURI: 'TSUPPARI_MAKURI',
  YIELD_KAMASI: 'YIELD_KAMASI'
});

export const START_BLOCK = Object.freeze({ TSUPPARI: 'TSUPPARI', YIELD: 'YIELD' });
export const MIDDLE_BLOCK = Object.freeze({ SECOND_ATTACK: 'SECOND_ATTACK', KAMASI: 'KAMASI', PACE_HOLD: 'PACE_HOLD' });
export const FINISH_BLOCK = Object.freeze({ MAKURI: 'MAKURI', NIGERIKIRI: 'NIGERIKIRI' });
export const GENERIC_PHASE = Object.freeze({
  PACER_CUT: 'PACER_CUT',
  START_RESOLUTION: 'START_RESOLUTION',
  MIDDLE_REACTION: 'MIDDLE_REACTION',
  MIDDLE_ACTION: 'MIDDLE_ACTION',
  FRONT_ESTABLISHED: 'FRONT_ESTABLISHED',
  FINISH_ACTION: 'FINISH_ACTION'
});

export const TSUPPARI_MAKURI_SCENARIO = Object.freeze({
  id: SCENARIO_TYPE.TSUPPARI_MAKURI,
  frontLineId: 'LINE_A',
  middleLineId: 'LINE_B',
  rearLineId: 'LINE_C',
  phaseThresholds: Object.freeze({
    phase1FallbackRemaining: 650,
    phase2EndRemaining: 410,
    phase3EndRemaining: 200,
    phase4EndRemaining: 68
  }),
  phase1: Object.freeze({
    frontSpeed: 11.4,
    middleSpeed: 11.0,
    attackerSpeed: 24.5,
    attackerLane: TRACK_LANE.OUTSIDE,
    contestGap: 5
  }),
  phase2: Object.freeze({
    frontSpeed: 16.0,
    middleSpeed: 16.0,
    retreatSpeed: 4.4,
    settleLane: TRACK_LANE.INNER
  }),
  phase3: Object.freeze({
    frontSpeed: 18.2,
    middleSpeed: 16.7,
    attackerSpeed: 31.0,
    approachLane: TRACK_LANE.OUTSIDE,
    squeezeLane: 10,
    squeezeGap: 18.0,
    contestLaneSeparation: 24
  }),
  phase4: Object.freeze({
    frontFadeSpeed: 14.4,
    makuriSpeed: 27.0,
    attackerFadeSpeed: 10.4,
    makuriLane: 28,
    blockStartRemaining: 112,
    blockGap: 28,
    blockDuration: 0.62,
    banteBlockLane: 12,
    makuriEvadeLane: 32,
    failedAttackLane: 46
  }),
  phase5: Object.freeze({
    speeds: Object.freeze({
      1: 17.0, 2: 27.2, 3: 20.0,
      4: 29.2, 5: 28.7, 6: 25.6,
      7: 12.0, 8: 12.2, 9: 12.4
    })
  })
});


export const YIELD_KAMASI_SCENARIO = Object.freeze({
  id: SCENARIO_TYPE.YIELD_KAMASI,
  blocks: Object.freeze({ start: START_BLOCK.YIELD, middle: MIDDLE_BLOCK.KAMASI, finish: FINISH_BLOCK.NIGERIKIRI }),
  roles: Object.freeze({ receivingLineId: 'LINE_A', middleLineId: 'LINE_B', pacerCutLineId: 'LINE_C', opportunistLineId: 'LINE_B', kamasiLineId: 'LINE_A' }),
  thresholds: Object.freeze({ pacerCutFallbackRemaining: 650, yieldSettleRemaining: 585, middleClearance: 7, middleSettleRemaining: 545, kamasiStartRemaining: 505, kamasiClearance: 7, finishStartRemaining: 125 }),
  speeds: Object.freeze({ receive: 11.4, pacerCut: 23.5, controlFront: 13.2, yield: 8.2, middle: 13.0, opportunistAttack: 25.0, opportunistControl: 15.0, kamasi: 28.4, chase: 20.0, finishLeader: 25.2, finishBante: 26.4, finishFollower: 23.2 }),
  lanes: Object.freeze({ inner: TRACK_LANE.INNER, attack: TRACK_LANE.OUTSIDE, kamasi: 30 })
});

export const SCENARIO_LIBRARY = Object.freeze({
  [SCENARIO_TYPE.TSUPPARI_MAKURI]: TSUPPARI_MAKURI_SCENARIO,
  [SCENARIO_TYPE.YIELD_KAMASI]: YIELD_KAMASI_SCENARIO
});

export function getScenarioDefinition(id = SCENARIO_TYPE.TSUPPARI_MAKURI) {
  return SCENARIO_LIBRARY[id] ?? SCENARIO_LIBRARY[SCENARIO_TYPE.TSUPPARI_MAKURI];
}

export const RUN_STYLE = Object.freeze({
  NIGE: 'NIGE',
  SENKO: 'SENKO',
  MAKURI: 'MAKURI',
  JIZAI: 'JIZAI'
});

export const ACTION = Object.freeze({
  FORMATION: 'FORMATION',
  CONTROL_PACE: 'CONTROL_PACE',
  MOVE_UP: 'MOVE_UP',
  ATTACK: 'ATTACK',
  DEFEND: 'DEFEND',
  CONTEST: 'CONTEST',
  FULL_CONTEST: 'FULL_CONTEST',
  YIELD: 'YIELD',
  RETREAT: 'RETREAT',
  FOLLOW: 'FOLLOW',
  BLOCK: 'BLOCK',
  SWITCH_TO_SELF_POWER: 'SWITCH_TO_SELF_POWER',
  SAVE_ENERGY: 'SAVE_ENERGY',
  FINAL_SPRINT: 'FINAL_SPRINT',
  FADE: 'FADE',
  KIRIKAE: 'KIRIKAE'
});

export const DEFAULT_RIDER_PROFILE = Object.freeze({
  power: 0.80,
  acceleration: 0.80,
  endurance: 0.80,
  tacticalIQ: 0.80,
  aggression: 0.65,
  riskTolerance: 0.50,
  attackEnergyFloor: 0.30,
  contestEnergyFloor: 0.24,
  idealGap: 17,
  topSpeed: 22.0,
  baseAcceleration: 4.0,
  sprintBonus: 3.0,
  blockSkill: 0.75,
  draftSkill: 0.75,
  runStyle: RUN_STYLE.JIZAI
});

export const DEFAULT_RACE_SETUP = Object.freeze({
  scenarioId: SCENARIO_TYPE.TSUPPARI_MAKURI,
  trackProfile: 'PROFILE_400',
  lines: [
    { id: 'LINE_A', members: [1, 2, 3], leader: 1 },
    { id: 'LINE_B', members: [4, 5, 6], leader: 4 },
    { id: 'LINE_C', members: [7, 8, 9], leader: 7 }
  ],
  riders: {
    1: { mindset: MINDSET.TSUPPARI, power: 0.88, acceleration: 0.90, endurance: 0.82, tacticalIQ: 0.80, aggression: 0.78, riskTolerance: 0.62 },
    2: { power: 0.82, acceleration: 0.82, endurance: 0.88, tacticalIQ: 0.88, blockSkill: 0.90 },
    3: { power: 0.78, acceleration: 0.78, endurance: 0.86, tacticalIQ: 0.80 },
    4: { runStyle: RUN_STYLE.NIGE, mindset: MINDSET.YIELD_AND_ROLL, power: 0.92, acceleration: 0.95, endurance: 0.90, tacticalIQ: 0.88, aggression: 0.72, riskTolerance: 0.58 },
    5: { power: 0.85, acceleration: 0.88, endurance: 0.90, tacticalIQ: 0.84, blockSkill: 0.80 },
    6: { power: 0.80, acceleration: 0.82, endurance: 0.88, tacticalIQ: 0.78 },
    7: { mindset: MINDSET.CONTAIN, power: 0.86, acceleration: 0.86, endurance: 0.84, tacticalIQ: 0.84, aggression: 0.75, riskTolerance: 0.64 },
    8: { power: 0.82, acceleration: 0.82, endurance: 0.86, tacticalIQ: 0.82, blockSkill: 0.78 },
    9: { power: 0.79, acceleration: 0.80, endurance: 0.84, tacticalIQ: 0.78 }
  }
});

export function mergeRiderProfile(profile = {}) {
  return { ...DEFAULT_RIDER_PROFILE, ...profile };
}

export function normalizeRaceSetup(input = DEFAULT_RACE_SETUP) {
  const lines = Array.isArray(input.lines) ? input.lines.map((line, index) => ({
    id: line.id ?? `LINE_${index + 1}`,
    members: [...line.members],
    leader: line.leader ?? line.members[0]
  })) : [];

  const seen = new Set();
  for (const line of lines) {
    if (line.members.length < 1) throw new Error(`Line ${line.id} must contain at least one rider.`);
    if (!line.members.includes(line.leader)) {
      throw new Error(`Line leader ${line.leader} must be a member of ${line.id}.`);
    }
    for (const number of line.members) {
      if (!Number.isInteger(number) || number < 1 || number > 9) {
        throw new Error(`Invalid rider number ${number} in ${line.id}.`);
      }
      if (seen.has(number)) {
        throw new Error(`Rider ${number} appears in more than one line.`);
      }
      seen.add(number);
    }
  }

  const assigned = new Set(lines.flatMap(line => line.members));
  const riders = {};

  for (let number = 1; number <= 9; number += 1) {
    const raw = input.riders?.[number] ?? {};
    const solo = raw.solo === true || !assigned.has(number);
    riders[number] = {
      ...mergeRiderProfile(raw),
      number,
      solo,
      soloMindset: raw.soloMindset ?? SOLO_MINDSET.FLOW_RIDE,
      mindset: raw.mindset ?? (solo ? null : MINDSET.YIELD_AND_ROLL)
    };
  }

  return {
    scenarioId: input.scenarioId ?? SCENARIO_TYPE.TSUPPARI_MAKURI,
    scenarioConfig: input.scenarioConfig ?? null,
    trackProfile: input.trackProfile ?? 'PROFILE_400',
    lines,
    riders
  };
}
