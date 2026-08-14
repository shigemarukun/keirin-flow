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
  FADE: 'FADE'
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
  draftSkill: 0.75
});

export const DEFAULT_RACE_SETUP = Object.freeze({
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
    4: { mindset: MINDSET.YIELD_AND_ROLL, power: 0.92, acceleration: 0.95, endurance: 0.90, tacticalIQ: 0.88, aggression: 0.72, riskTolerance: 0.58 },
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
    if (line.members.length < 2) {
      throw new Error(`Single-rider line ${line.id} is invalid. Register that rider as solo instead.`);
    }
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
    trackProfile: input.trackProfile ?? 'PROFILE_400',
    lines,
    riders
  };
}
