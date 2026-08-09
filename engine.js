import { ACTION, FOLLOW_STATUS, TACTIC, DEFAULT_RIDER_CAPABILITY } from './tactics.js';
import { DEFAULT_RACE_PLAN } from './race-plan.js';

const CAR_STYLES = Object.freeze({
    1: { background: '#ffffff', text: '#111111' },
    2: { background: '#222222', text: '#ffffff' },
    3: { background: '#e60012', text: '#ffffff' },
    4: { background: '#0068b7', text: '#ffffff' },
    5: { background: '#ffd400', text: '#111111' },
    6: { background: '#00a651', text: '#ffffff' },
    7: { background: '#f08300', text: '#111111' },
    8: { background: '#ff69b4', text: '#111111' },
    9: { background: '#7f3fbf', text: '#ffffff' }
});

const RACE_STATE = Object.freeze({ POSITION_BATTLE: 'POSITION_BATTLE', FINAL: 'FINAL', FINISHED: 'FINISHED' });
const PACER_STATE = Object.freeze({ LEADING: 'LEADING', EXITING: 'EXITING', EXITED: 'EXITED' });
const CLOCK_OWNER = Object.freeze({ PACER: 'PACER', LEADER: 'LEADER' });
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrapTrack = (d, l) => ((d % l) + l) % l;

export const RACE_PROFILES = Object.freeze({
    PROFILE_400: {
        TRACK_LENGTH: 400,
        RACE_DISTANCE: 800,
        FORMATION_SPEED: 10.5,
        PacerLeaveLine: 620,
        Bell: 600,
        PacerExit: 560,
        FinalLap: 400,
        FinalBack: 200,
        Finish: 0
    }
});
export const RACE_CONFIG = RACE_PROFILES.PROFILE_400;

export class RaceClock {
    constructor(config = RACE_CONFIG) {
        this.config = config;
        this.trackLength = config.TRACK_LENGTH;
        this.totalDistance = config.RACE_DISTANCE;
        this.events = {
            PacerLeaveLine: { fired: false, condition: c => c.remainingDistance <= config.PacerLeaveLine },
            Bell: { fired: false, condition: c => c.remainingDistance <= config.Bell },
            PacerExit: { fired: false, condition: c => c.remainingDistance <= config.PacerExit },
            FinalLap: { fired: false, condition: c => c.remainingDistance <= config.FinalLap },
            FinalBack: { fired: false, condition: c => c.remainingDistance <= config.FinalBack },
            Finish: { fired: false, condition: c => c.remainingDistance <= 0 }
        };
        this.reset();
    }
    update(pacerDistance, leaderDistance, engine) {
        if (engine.pacer.state === PACER_STATE.EXITED) this.owner = CLOCK_OWNER.LEADER;
        const candidate = this.owner === CLOCK_OWNER.PACER ? pacerDistance : leaderDistance;
        this.referenceDistance = Math.max(this.referenceDistance, candidate);
        this.remainingDistance = Math.max(0, this.totalDistance - this.referenceDistance);
        this.currentLap = this.remainingDistance > this.trackLength ? 2 : 1;
        const order = ['PacerLeaveLine', 'Bell', 'PacerExit', 'FinalLap', 'FinalBack', 'Finish'];
        const triggered = [];
        for (const name of order) {
            const ev = this.events[name];
            if (!ev.fired && ev.condition(this, engine)) {
                ev.fired = true;
                triggered.push(name);
                this.firedEventSequence.push(name);
            }
        }
        return triggered;
    }
    reset() {
        this.owner = CLOCK_OWNER.PACER;
        this.referenceDistance = 0;
        this.remainingDistance = this.totalDistance;
        this.currentLap = 2;
        this.firedEventSequence = [];
        for (const ev of Object.values(this.events)) ev.fired = false;
    }
}

export class PhysicsEngine {
    constructor(lineGroups, lineOffsets = [-18, -6, 6, 18], profile = RACE_CONFIG, racePlan = DEFAULT_RACE_PLAN) {
        this.lineGroups = lineGroups.map(g => [...g]);
        this.lineOffsets = [...lineOffsets];
        this.profile = profile;
        this.totalDistance = profile.RACE_DISTANCE;
        this.racePlan = racePlan;
        this.timeScale = 1;
        this.onBellCallback = null;
        this.onFinishCallback = null;
        this.RACE_STATE = RACE_STATE;
        this.PACER_STATE = PACER_STATE;
        this.raceClock = new RaceClock(profile);
        this._buildRiders();
        this.reset();
    }

    _buildRiders() {
        this.riders = [];
        let globalIndex = 0;
        this.lineGroups.forEach((group, lineId) => {
            group.forEach((number, lineOrder) => {
                const initialDistance = -14 - globalIndex * 17;
                const plan = this.racePlan[number] ?? { tactic: TACTIC.HOLD };
                const capability = { ...DEFAULT_RIDER_CAPABILITY, acceleration: lineOrder === 0 ? 3.2 : (lineOrder === 1 ? 3.8 : 3.9), response: lineOrder === 0 ? 1.0 : 1.06, topSpeed: lineOrder === 0 ? 21.0 : 22.5 };
                this.riders.push({
                    number, lineId, lineOrder, globalIndex,
                    isLeader: lineOrder === 0,
                    initialDistance,
                    initialLaneOffset: -18,
                    baseLaneOffset: this.lineOffsets[lineId % this.lineOffsets.length],
                    style: CAR_STYLES[number] ?? CAR_STYLES[1],
                    plan,
                    capability,
                    lineFrontNumber: lineOrder > 0 ? group[lineOrder - 1] : null,
                    distance: initialDistance,
                    speed: profileSafeSpeed(this.profile),
                    acceleration: 0,
                    laneOffset: -18,
                    action: ACTION.FORMATION,
                    followTargetNumber: plan.followNumber ?? (lineOrder > 0 ? group[lineOrder - 1] : null),
                    followStatus: lineOrder === 0 ? FOLLOW_STATUS.LEADER : FOLLOW_STATUS.ATTACHED,
                    detachedTime: 0,
                    attackCompleted: false,

                    // Causal race state.  Strategy asks for an action; these
                    // values determine how strongly the rider can actually execute it.
                    energy: capability.energyCapacity,
                    fatigue: 0,
                    effort: 0,
                    drafting: false,
                    load: 0,

                    finished: false,
                    finishTime: null,
                    history: []
                });
                globalIndex += 1;
            });
        });
    }

    reset() {
        this.isStarted = false;
        this.elapsedTime = 0;
        this.bellRung = false;
        this.currentState = RACE_STATE.POSITION_BATTLE;
        this.ranking = [];
        this.raceClock.reset();
        this.pacer = { distance: 0, speed: this.profile.FORMATION_SPEED, state: PACER_STATE.LEADING, laneOffset: -18, exitProgress: 0 };
        for (const rider of this.riders) {
            rider.distance = rider.initialDistance;
            rider.speed = this.profile.FORMATION_SPEED;
            rider.acceleration = 0;
            rider.laneOffset = rider.initialLaneOffset;
            rider.action = ACTION.FORMATION;
            rider.followTargetNumber = rider.plan.followNumber ?? rider.lineFrontNumber;
            rider.followStatus = rider.isLeader ? FOLLOW_STATUS.LEADER : FOLLOW_STATUS.ATTACHED;
            rider.detachedTime = 0;
            rider.attackCompleted = false;
            rider.energy = rider.capability.energyCapacity;
            rider.fatigue = 0;
            rider.effort = 0;
            rider.drafting = false;
            rider.load = 0;
            rider.finished = false;
            rider.finishTime = null;
            rider.history = [];
        }
    }

    start() { if (this.riders.every(r => r.finished)) this.reset(); this.isStarted = true; }
    pause() { this.isStarted = false; }
    setSpeedScale(scale) { this.timeScale = clamp(Number(scale) || 1, 0.25, 4); }
    onBell(cb) { this.onBellCallback = cb; }
    onFinish(cb) { this.onFinishCallback = cb; }

    _rider(number) { return this.riders.find(r => r.number === number) ?? null; }

    _updatePacer(dt) {
        if (this.pacer.state === PACER_STATE.EXITED) return;
        this.pacer.distance += this.pacer.speed * dt;
        if (this.raceClock.events.PacerLeaveLine.fired && this.pacer.state === PACER_STATE.LEADING) this.pacer.state = PACER_STATE.EXITING;
        if (this.pacer.state === PACER_STATE.EXITING) {
            const targetProgress = this.raceClock.events.PacerExit.fired ? 1 : 0.7;
            this.pacer.exitProgress = Math.min(targetProgress, this.pacer.exitProgress + 0.8 * dt);
            const eased = this.pacer.exitProgress * this.pacer.exitProgress * (3 - 2 * this.pacer.exitProgress);
            this.pacer.laneOffset = -18 - 72 * eased;
            if (this.raceClock.events.PacerExit.fired && this.pacer.exitProgress >= 1) {
                this.pacer.state = PACER_STATE.EXITED;
                this.currentState = RACE_STATE.FINAL;
            }
        }
    }

    _resolveLeaderAction(rider) {
        const p = rider.plan;
        const remaining = this.raceClock.remainingDistance;

        if (rider.number === 4 && p.preFollowNumber && remaining <= p.preFollowTriggerRemaining && remaining > p.triggerRemaining) {
            rider.followTargetNumber = p.preFollowNumber;
            return ACTION.FOLLOW;
        }

        if (p.tactic === TACTIC.OSAE_SENKO) {
            if (remaining <= p.defendFromRemaining && remaining > p.defendUntilRemaining) return ACTION.DEFEND;
            if (remaining <= p.settleRemaining) return ACTION.LEAD;
            if (remaining <= p.triggerRemaining) return ACTION.MOVE_UP;
            return ACTION.FORMATION;
        }

        if (p.tactic === TACTIC.MAKURI || p.tactic === TACTIC.NAKADAN_MAKURI || p.tactic === TACTIC.KAMASHI) {
            if (!rider.attackCompleted && remaining <= p.triggerRemaining) return ACTION.ATTACK;
            if (rider.attackCompleted) return ACTION.LEAD;
            return ACTION.FORMATION;
        }

        if (p.tactic === TACTIC.TSUPPARI) {
            return remaining <= p.triggerRemaining ? ACTION.DEFEND : ACTION.FORMATION;
        }

        return ACTION.FORMATION;
    }

    _updateActionAndFollow(rider, dt) {
        if (rider.isLeader) {
            rider.action = this._resolveLeaderAction(rider);
        } else {
            rider.action = ACTION.FOLLOW;
            if (!rider.followTargetNumber) rider.followTargetNumber = rider.lineFrontNumber;
        }

        const p = rider.plan;
        if (rider.isLeader && rider.action === ACTION.ATTACK && p.attackTargetNumber) {
            const target = this._rider(p.attackTargetNumber);
            if (target && rider.distance >= target.distance + (p.settleAfterPassMeters ?? 6)) {
                rider.attackCompleted = true;
                rider.action = ACTION.LEAD;
            }
        }

        const target = rider.followTargetNumber ? this._rider(rider.followTargetNumber) : null;
        if (!target || target.finished) {
            if (!rider.isLeader) rider.followStatus = FOLLOW_STATUS.DETACHED;
            return;
        }

        const gap = target.distance - rider.distance;
        if (gap > 26) {
            rider.followStatus = FOLLOW_STATUS.DETACHED;
            rider.detachedTime += dt;
        } else if (gap > 16) {
            rider.followStatus = FOLLOW_STATUS.STRETCHED;
            rider.detachedTime = Math.max(0, rider.detachedTime - dt * 0.5);
        } else {
            rider.followStatus = FOLLOW_STATUS.ATTACHED;
            rider.detachedTime = 0;
        }

        // Dynamic switching foundation: affiliation never changes.  Only the
        // follow target can change after a genuine separation.
        if (!rider.isLeader && rider.followStatus === FOLLOW_STATUS.DETACHED && rider.detachedTime > 0.7) {
            const candidate = this._findSwitchCandidate(rider);
            if (candidate) {
                rider.followTargetNumber = candidate.number;
                rider.action = ACTION.SWITCH;
                rider.detachedTime = 0;
            }
        }
    }

    _findSwitchCandidate(rider) {
        const candidates = this.riders
            .filter(other => other.number !== rider.number && !other.finished)
            .map(other => ({ other, gap: other.distance - rider.distance, laneGap: Math.abs(other.laneOffset - rider.laneOffset) }))
            .filter(x => x.gap >= 5 && x.gap <= 28 && x.laneGap <= 36)
            .sort((a, b) => a.gap - b.gap || a.laneGap - b.laneGap);
        return candidates[0]?.other ?? null;
    }

    _draftFactor(rider) {
        const target = rider.followTargetNumber ? this._rider(rider.followTargetNumber) : null;
        if (!target || target.finished || target.distance <= rider.distance) return 0;
        const gap = target.distance - rider.distance;
        const laneGap = Math.abs(target.laneOffset - rider.laneOffset);
        if (gap < 4.5 || gap > 13.5 || laneGap > 16) return 0;

        // Best shelter is around a normal following gap.  It fades smoothly
        // toward the edge of the usable pocket.
        const gapQuality = 1 - Math.min(1, Math.abs(gap - 8.5) / 5.0);
        const laneQuality = 1 - Math.min(1, laneGap / 16);
        return clamp(gapQuality * laneQuality, 0, 1);
    }

    _fatigueFactor(rider) {
        const c = rider.capability;
        const start = c.fatigueStart ?? 0.55;
        if (rider.energy >= start) return 1;
        const ratio = clamp(rider.energy / Math.max(start, 1e-6), 0, 1);
        return (c.fatigueFloor ?? 0.56) + (1 - (c.fatigueFloor ?? 0.56)) * ratio;
    }

    _effectiveTopSpeed(rider) {
        const c = rider.capability;
        const fatigue = this._fatigueFactor(rider);
        // A tired rider loses both peak speed and the ability to keep adding speed.
        return Math.max(this.profile.FORMATION_SPEED * 0.90, c.topSpeed * (0.72 + 0.28 * fatigue));
    }

    _updateEnergy(rider, desiredSpeed, dt) {
        const c = rider.capability;
        const base = this.profile.FORMATION_SPEED;
        const draft = this._draftFactor(rider);
        rider.drafting = draft > 0.12;

        const speedDemand = Math.max(0, desiredSpeed - base) / Math.max(base, 1);
        const accelerationDemand = Math.max(0, desiredSpeed - rider.speed) / Math.max(c.acceleration, 0.1);

        let actionCost = c.cruiseCost ?? 0.0025;
        if (rider.action === ACTION.ATTACK || rider.action === ACTION.MOVE_UP) actionCost = c.attackCost ?? 0.0120;
        else if (rider.action === ACTION.DEFEND) actionCost = c.defendCost ?? 0.0130;
        else if (rider.action === ACTION.LEAD) actionCost = c.leadCost ?? 0.0068;
        else if (rider.action === ACTION.FOLLOW || rider.action === ACTION.SWITCH) actionCost = c.cruiseCost ?? 0.0025;

        // Riding wider than the normal line has a small but real simulation cost.
        const outerExposure = Math.max(0, rider.laneOffset - (-18)) / 48;
        const outerCost = outerExposure * (c.outerLaneCost ?? 0.16);

        let load = actionCost * (
            1 +
            1.55 * speedDemand * speedDemand +
            0.65 * accelerationDemand +
            outerCost
        );

        // Following in the pocket saves energy.  The line can therefore shelter
        // a rider without welding the riders together spatially.
        load *= 1 - draft * (c.draftSaving ?? 0.30);
        load /= Math.max(0.55, c.endurance ?? 1);

        const isEasy = desiredSpeed <= base * 1.08 && rider.action !== ACTION.ATTACK && rider.action !== ACTION.DEFEND;
        const recovery = isEasy ? (c.recoveryRate ?? 0.0018) * (0.35 + 0.65 * draft) : 0;

        rider.load = load;
        rider.effort = clamp(speedDemand + accelerationDemand * 0.35, 0, 2);
        rider.energy = clamp(rider.energy - load * dt + recovery * dt, 0, c.energyCapacity ?? 1);
        rider.fatigue = 1 - rider.energy / Math.max(c.energyCapacity ?? 1, 1e-6);
    }

    _desiredSpeed(rider) {
        const p = rider.plan;
        const base = this.profile.FORMATION_SPEED;
        const top = this._effectiveTopSpeed(rider);

        let requested;
        if (rider.action === ACTION.MOVE_UP || rider.action === ACTION.ATTACK) requested = p.attackSpeed ?? base * 1.65;
        else if (rider.action === ACTION.DEFEND) requested = p.defendSpeed ?? base * 1.58;
        else if (rider.action === ACTION.LEAD) requested = p.leadSpeed ?? base * 1.40;
        else {
            const target = rider.followTargetNumber ? this._rider(rider.followTargetNumber) : null;
            if (rider.action === ACTION.FOLLOW || rider.action === ACTION.SWITCH) {
                if (!target || target.finished) requested = base * 1.35;
                else {
                    const gap = target.distance - rider.distance;
                    const desiredGap = rider.lineOrder >= 2 ? 10.5 : 9.0;
                    const lower = desiredGap - 2.0;
                    const upper = desiredGap + 3.5;
                    if (gap >= lower && gap <= upper) requested = target.speed;
                    else {
                        const correction = gap < lower ? (gap - lower) * 0.20 : (gap - upper) * 0.24;
                        requested = clamp(target.speed + correction, Math.max(0, target.speed - 1.0), target.speed + 4.2);
                    }
                }
            } else if (rider.isLeader) {
                const gapError = (this.pacer.distance - 14) - rider.distance;
                requested = clamp(this.pacer.speed + gapError * 0.06, this.pacer.speed - 0.4, this.pacer.speed + 0.6);
            } else if (target) {
                const gap = target.distance - rider.distance;
                const desiredGap = rider.lineOrder >= 2 ? 10.5 : 9.0;
                requested = clamp(target.speed + (gap - desiredGap) * 0.18, target.speed - 0.7, target.speed + 1.6);
            } else requested = base;
        }

        return clamp(requested, 0, top);
    }

    _targetLane(rider) {
        const p = rider.plan;
        if (rider.action === ACTION.MOVE_UP || rider.action === ACTION.ATTACK) return p.attackLane ?? 26;
        if (rider.action === ACTION.DEFEND || rider.action === ACTION.LEAD) return -18;
        const target = rider.followTargetNumber ? this._rider(rider.followTargetNumber) : null;
        if ((rider.action === ACTION.FOLLOW || rider.action === ACTION.SWITCH) && target) return target.laneOffset;
        return -18;
    }

    _move(rider, desiredSpeed, dt) {
        const previousSpeed = rider.speed;
        const fatigueFactor = this._fatigueFactor(rider);
        const accel = rider.capability.acceleration * rider.capability.response * (0.58 + 0.42 * fatigueFactor);
        const decel = rider.capability.deceleration;
        if (rider.speed < desiredSpeed) rider.speed = Math.min(desiredSpeed, rider.speed + accel * dt);
        else if (rider.speed > desiredSpeed) rider.speed = Math.max(desiredSpeed, rider.speed - decel * dt);

        const laneTarget = this._targetLane(rider);
        const laneRate = rider.isLeader ? 2.2 : (rider.lineOrder >= 2 ? 1.15 : 1.45);
        rider.laneOffset += (laneTarget - rider.laneOffset) * clamp(laneRate * dt, 0, 1);

        let nextDistance = rider.distance + rider.speed * dt;
        const target = rider.followTargetNumber ? this._rider(rider.followTargetNumber) : null;
        const safetyGap = 5.5;
        if (target && !target.finished && target.distance > rider.distance) {
            nextDistance = Math.min(nextDistance, target.distance - safetyGap);
            if (nextDistance >= target.distance - safetyGap && rider.speed > target.speed) rider.speed = target.speed;
        }
        rider.distance = nextDistance;
        rider.acceleration = (rider.speed - previousSpeed) / Math.max(dt, 1e-6);
    }

    _recordFinish(rider) {
        rider.distance = this.totalDistance;
        rider.finished = true;
        rider.finishTime = this.elapsedTime;
        this.ranking.push({ rank: 0, number: rider.number, lineId: rider.lineId, time: rider.finishTime, margin: '' });
    }

    _finalizeRanking() {
        this.ranking.sort((a, b) => a.time - b.time || a.number - b.number);
        const winner = this.ranking[0]?.time ?? 0;
        this.ranking.forEach((item, i) => {
            item.rank = i + 1;
            const meters = (item.time - winner) * 10.5;
            item.margin = i === 0 ? '先頭' : meters < 0.12 ? 'ハナ' : meters < 0.25 ? 'アタマ' : meters < 0.7 ? '1/2車身' : meters < 1.1 ? '1車身' : `${meters.toFixed(1)}車身`;
        });
    }

    _recordHistory() {
        const sorted = [...this.riders].sort((a, b) => b.distance - a.distance);
        const positions = new Map(sorted.map((r, i) => [r.number, i + 1]));
        for (const rider of this.riders) {
            rider.history.push({
                time: this.elapsedTime,
                distance: rider.distance,
                speed: rider.speed,
                acceleration: rider.acceleration,
                laneOffset: rider.laneOffset,
                position: positions.get(rider.number),
                action: rider.action,
                followTargetNumber: rider.followTargetNumber,
                followStatus: rider.followStatus,
                energy: rider.energy,
                fatigue: rider.fatigue,
                effort: rider.effort,
                drafting: rider.drafting,
                load: rider.load
            });
            if (rider.history.length > 1200) rider.history.shift();
        }
    }

    update(dt) {
        if (!this.isStarted) return;
        const frameDt = clamp(Number(dt) || 0, 0, 0.1) * this.timeScale;
        const maxStep = 1 / 120;
        const steps = Math.max(1, Math.ceil(frameDt / maxStep));
        const stepDt = frameDt / steps;
        for (let step = 0; step < steps; step += 1) {
            this.elapsedTime += stepDt;
            this._updatePacer(stepDt);
            for (const rider of this.riders) {
                if (rider.finished) continue;
                const previousDistance = rider.distance;
                this._updateActionAndFollow(rider, stepDt);
                const desiredSpeed = this._desiredSpeed(rider);
                this._updateEnergy(rider, desiredSpeed, stepDt);
                this._move(rider, desiredSpeed, stepDt);
                if (previousDistance < this.totalDistance && rider.distance >= this.totalDistance) this._recordFinish(rider);
            }
            const leader = this.riders.reduce((max, r) => r.distance > max.distance ? r : max, this.riders[0]);
            const triggered = this.raceClock.update(this.pacer.distance, leader?.distance ?? 0, this);
            if (triggered.includes('Bell')) { this.bellRung = true; this.onBellCallback?.(); }
        }
        this._recordHistory();
        if (this.riders.every(r => r.finished)) {
            this.isStarted = false;
            this.currentState = RACE_STATE.FINISHED;
            this._finalizeRanking();
            this.onFinishCallback?.(this.ranking.map(x => ({ ...x })));
        }
    }

    getDiagnostics() {
        const gaps = this.riders.map(rider => {
            const front = rider.followTargetNumber ? this._rider(rider.followTargetNumber) : null;
            return { rider, front };
        }).filter(({ rider, front }) => front && !rider.finished && !front.finished && front.distance > rider.distance)
          .map(({ rider, front }) => ({ number: rider.number, frontNumber: front.number, gap: front.distance - rider.distance }));
        return {
            gaps,
            minGap: gaps.length ? Math.min(...gaps.map(x => x.gap)) : null,
            maxGap: gaps.length ? Math.max(...gaps.map(x => x.gap)) : null,
            raceClock: {
                owner: this.raceClock.owner,
                remainingDistance: this.raceClock.remainingDistance,
                currentLap: this.raceClock.currentLap,
                eventsFired: Object.fromEntries(Object.entries(this.raceClock.events).map(([k, v]) => [k, v.fired])),
                firedSequence: this.raceClock.firedEventSequence
            }
        };
    }

    getState() {
        return {
            riders: this.riders,
            pacer: this.pacer,
            ranking: this.ranking,
            isStarted: this.isStarted,
            currentState: this.currentState,
            elapsedTime: this.elapsedTime,
            totalDistance: this.totalDistance,
            bellRung: this.bellRung,
            diagnostics: this.getDiagnostics(),
            raceClock: this.raceClock
        };
    }
}

function profileSafeSpeed(profile) {
    return Number(profile?.FORMATION_SPEED) || 10.5;
}
