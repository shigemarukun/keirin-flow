export const SCENARIO_PHASE = Object.freeze({
    FORMATION: 'FORMATION',
    FIRST_MOVE: 'FIRST_MOVE',
    FIRST_CONTEST: 'FIRST_CONTEST',
    FIRST_RETREAT: 'FIRST_RETREAT',
    RESET_LINEUP: 'RESET_LINEUP',
    SECOND_MOVE: 'SECOND_MOVE',
    SECOND_CONTEST: 'SECOND_CONTEST',
    LINE7_FADE: 'LINE7_FADE',
    LINE4_MAKURI: 'LINE4_MAKURI',
    BANTE_BLOCK: 'BANTE_BLOCK',
    FIVE_REACTION: 'FIVE_REACTION',
    FIVE_DIVE: 'FIVE_DIVE',
    FINAL: 'FINAL'
});

export class ScenarioBController {
    constructor() { this.reset(); }

    reset() {
        this.phase = SCENARIO_PHASE.FORMATION;
        this.phaseTime = 0;
        this.firstContestTime = 0;
        this.secondContestTime = 0;
        this.blockTime = 0;
        this.fiveReactionTime = 0;
        this.firstAlongside = false;
        this.secondAlongside = false;
        this.flags = {
            firstAttackStarted: false,
            firstContestStarted: false,
            firstRetreatCompleted: false,
            finalLapReset: false,
            secondAttackStarted: false,
            secondContestStarted: false,
            sevenFadedBehindMiddle: false,
            fourAttackStarted: false,
            blockStarted: false,
            fiveReactionStarted: false,
            fiveDiveStarted: false,
            blockContactCompleted: false
        };
    }

    setPhase(next, engine) {
        if (next === this.phase) return;
        this.phase = next;
        this.phaseTime = 0;
        engine.emitRaceEvent('SCENARIO_PHASE', { phase: next });
    }

    update(dt, engine) {
        this.phaseTime += dt;
        const rem = engine.raceClock.remainingDistance;
        const r = n => engine.rider(n);
        const one = r(1), two = r(2), four = r(4), five = r(5), six = r(6), seven = r(7), nine = r(9);

        switch (this.phase) {
            case SCENARIO_PHASE.FORMATION:
                if (rem <= 665) {
                    this.flags.firstAttackStarted = true;
                    this.setPhase(SCENARIO_PHASE.FIRST_MOVE, engine);
                }
                break;

            case SCENARIO_PHASE.FIRST_MOVE: {
                // 7 really has to travel from the rear to the front.
                // 1 reacts only when the attack has actually arrived.
                const gapToOne = one.distance - seven.distance;
                if (gapToOne <= 16) {
                    this.flags.firstContestStarted = true;
                    this.setPhase(SCENARIO_PHASE.FIRST_CONTEST, engine);
                }
                break;
            }

            case SCENARIO_PHASE.FIRST_CONTEST: {
                const overlap = Math.abs(one.distance - seven.distance) <= 5.5;
                if (overlap) this.firstAlongside = true;
                if (this.firstAlongside) this.firstContestTime += dt;
                // In this reference race 1 wins only after the two leaders have
                // genuinely reached a side-by-side contest.
                if (this.firstAlongside && this.firstContestTime >= 1.10) {
                    this.setPhase(SCENARIO_PHASE.FIRST_RETREAT, engine);
                }
                break;
            }

            case SCENARIO_PHASE.FIRST_RETREAT:
                // Retreat is complete only when the full 7-line is behind the middle line.
                if (seven.distance < six.distance - 2 && nine.distance < six.distance - 10) {
                    this.flags.firstRetreatCompleted = true;
                    this.setPhase(SCENARIO_PHASE.RESET_LINEUP, engine);
                }
                break;

            case SCENARIO_PHASE.RESET_LINEUP: {
                const eight = r(8);
                // Re-form the line at a usable rolling speed before launching again.
                // This avoids a second attack that begins from an artificial 6 km/h crawl.
                const lineRecovered = seven.speed >= 13.2 && eight.speed >= 12.8 && nine.speed >= 12.6;
                if (rem <= 405 && lineRecovered) {
                    this.flags.finalLapReset = true;
                    this.setPhase(SCENARIO_PHASE.SECOND_MOVE, engine);
                }
                break;
            }

            case SCENARIO_PHASE.SECOND_MOVE: {
                this.flags.secondAttackStarted = true;
                const gapToOne = one.distance - seven.distance;
                if (gapToOne <= 8) {
                    this.flags.secondContestStarted = true;
                    this.setPhase(SCENARIO_PHASE.SECOND_CONTEST, engine);
                }
                break;
            }

            case SCENARIO_PHASE.SECOND_CONTEST:
                const overlap = Math.abs(one.distance - seven.distance) <= 5.5;
                if (overlap) this.secondAlongside = true;
                if (this.secondAlongside) this.secondContestTime += dt;
                if (this.secondAlongside && this.secondContestTime >= 2.0) {
                    this.setPhase(SCENARIO_PHASE.LINE7_FADE, engine);
                }
                break;

            case SCENARIO_PHASE.LINE7_FADE: {
                // The failed second attack must visibly collapse before the middle line launches.
                // No remaining-distance shortcut: 4 reacts to the actual loss of speed and the
                // spent line drifting outside, then attacks through the emerging space.
                const eight = r(8);
                const lineSpent = seven.speed <= 16.4 && eight.speed <= 17.2 && nine.speed <= 18.0;
                const lineOutside = seven.laneOffset >= 34 && eight.laneOffset >= 34;
                const fadeVisible = this.phaseTime >= 0.48;
                if (fadeVisible && lineSpent && lineOutside) {
                    this.flags.sevenFadedBehindMiddle = true;
                    this.flags.fourAttackStarted = true;
                    this.setPhase(SCENARIO_PHASE.LINE4_MAKURI, engine);
                }
                break;
            }

            case SCENARIO_PHASE.LINE4_MAKURI: {
                const gap4to2 = two.distance - four.distance;
                // The block phase begins only when 4's actual makuri reaches the
                // bante's defensive window. No pre-programmed early lane slide.
                if (gap4to2 <= 24 && gap4to2 >= -4 && ['ATTACK','OVERTAKE'].includes(four.action) && this.phaseTime >= 0.25) {
                    this.flags.blockStarted = true;
                    this.setPhase(SCENARIO_PHASE.BANTE_BLOCK, engine);
                }
                break;
            }

            case SCENARIO_PHASE.BANTE_BLOCK:
                // Weighty bante block: 2 must actually move outward and spend time
                // alongside the threat before the following rider can react.
                if (two.action === 'BLOCK') this.blockTime += dt;
                if (two.action === 'BLOCK' && two.laneOffset >= 10 && this.blockTime >= 1.10) {
                    this.flags.blockContactCompleted = true;
                    this.flags.fiveReactionStarted = true;
                    this.setPhase(SCENARIO_PHASE.FIVE_REACTION, engine);
                }
                break;

            case SCENARIO_PHASE.FIVE_REACTION:
                // Human reaction delay. 5 first reads 2 moving out, briefly mirrors
                // the outside motion, then commits to the open inside course.
                this.fiveReactionTime += dt;
                if (this.fiveReactionTime >= (five?.plan?.diveReaction ?? 0.24)) {
                    this.flags.fiveDiveStarted = true;
                    this.setPhase(SCENARIO_PHASE.FIVE_DIVE, engine);
                }
                break;

            case SCENARIO_PHASE.FIVE_DIVE:
                if (rem <= 32 && this.phaseTime >= 0.45) this.setPhase(SCENARIO_PHASE.FINAL, engine);
                break;

            case SCENARIO_PHASE.FINAL:
            default:
                break;
        }
    }
}
