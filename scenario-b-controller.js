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
            fiveDiveStarted: false
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
        const one = r(1), four = r(4), six = r(6), seven = r(7), nine = r(9);

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
                if ((this.firstAlongside && this.firstContestTime >= 1.8) || rem <= 535) {
                    this.setPhase(SCENARIO_PHASE.FIRST_RETREAT, engine);
                }
                break;
            }

            case SCENARIO_PHASE.FIRST_RETREAT:
                // Retreat is complete only when the full 7-line is behind the middle line.
                if (seven.distance < six.distance - 8 && nine.distance < six.distance - 10) {
                    this.flags.firstRetreatCompleted = true;
                    this.setPhase(SCENARIO_PHASE.RESET_LINEUP, engine);
                }
                break;

            case SCENARIO_PHASE.RESET_LINEUP:
                if (rem <= 405 && this.phaseTime >= 0.55) {
                    this.flags.finalLapReset = true;
                    this.setPhase(SCENARIO_PHASE.SECOND_MOVE, engine);
                }
                break;

            case SCENARIO_PHASE.SECOND_MOVE: {
                this.flags.secondAttackStarted = true;
                const gapToOne = one.distance - seven.distance;
                if (gapToOne <= 18) {
                    this.flags.secondContestStarted = true;
                    this.setPhase(SCENARIO_PHASE.SECOND_CONTEST, engine);
                }
                break;
            }

            case SCENARIO_PHASE.SECOND_CONTEST:
                const overlap = Math.abs(one.distance - seven.distance) <= 5.5;
                if (overlap) this.secondAlongside = true;
                if (this.secondAlongside) this.secondContestTime += dt;
                if ((this.secondAlongside && this.secondContestTime >= 2.8) || (rem <= 105 && this.phaseTime >= 0.65)) {
                    this.setPhase(SCENARIO_PHASE.LINE7_FADE, engine);
                }
                break;

            case SCENARIO_PHASE.LINE7_FADE:
                // Middle line does not launch merely because a distance threshold was crossed.
                // It launches once the spent outside line has physically fallen behind it.
                if (rem <= 165 && seven.speed < four.speed + 0.5) {
                    this.flags.sevenFadedBehindMiddle = true;
                    this.flags.fourAttackStarted = true;
                    this.setPhase(SCENARIO_PHASE.LINE4_MAKURI, engine);
                }
                break;

            case SCENARIO_PHASE.LINE4_MAKURI: {
                const gap4to1 = one.distance - four.distance;
                if (gap4to1 <= 45 && rem <= 120 && this.phaseTime >= 0.45) {
                    this.flags.blockStarted = true;
                    this.setPhase(SCENARIO_PHASE.BANTE_BLOCK, engine);
                }
                break;
            }

            case SCENARIO_PHASE.BANTE_BLOCK:
                this.blockTime += dt;
                if (this.blockTime >= 0.50) {
                    this.flags.fiveDiveStarted = true;
                    this.setPhase(SCENARIO_PHASE.FIVE_DIVE, engine);
                }
                break;

            case SCENARIO_PHASE.FIVE_DIVE:
                if (rem <= 45) this.setPhase(SCENARIO_PHASE.FINAL, engine);
                break;

            case SCENARIO_PHASE.FINAL:
            default:
                break;
        }
    }
}
