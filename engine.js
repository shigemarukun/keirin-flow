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

const RACE_STATE = Object.freeze({
    POSITION_BATTLE: 'POSITION_BATTLE',
    FINAL: 'FINAL',
    FINISHED: 'FINISHED'
});

const PACER_STATE = Object.freeze({
    LEADING: 'LEADING',
    EXITING: 'EXITING',
    EXITED: 'EXITED'
});

const CLOCK_OWNER = Object.freeze({
    PACER: 'PACER',
    LEADER: 'LEADER'
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrapTrack = (distance, trackLength) => ((distance % trackLength) + trackLength) % trackLength;

/**
 * 将来的なバンク長（333m, 400m, 500m）やレース距離の拡張を見据えたプロファイル設計
 */
export const RACE_PROFILES = Object.freeze({
    PROFILE_400: {
        TRACK_LENGTH: 400,
        RACE_DISTANCE: 800, // 2周回レース（赤板スタート）
        FORMATION_SPEED: 10.5,
        // TODO: 以下はすべて「仮値」。実レース映像でチューニング予定
        PacerLeaveLine: 620,
        Bell: 600,
        PacerExit: 560,
        FinalLap: 400,
        FinalBack: 200,
        Finish: 0
    }
    // TODO: PROFILE_333 や PROFILE_500 を将来ここに追加する
});

// デフォルトプロファイル（400バンク想定）
export const RACE_CONFIG = RACE_PROFILES.PROFILE_400;

export class RaceClock {
    constructor(config = RACE_CONFIG) {
        this.trackLength = config.TRACK_LENGTH;
        this.totalDistance = config.RACE_DISTANCE;
        this.config = config;
        this.owner = CLOCK_OWNER.PACER;
        this.referenceDistance = 0;
        this.remainingDistance = this.totalDistance;
        this.currentLap = 2;
        this.firedEventSequence = [];

        this.events = {
            PacerLeaveLine: { name: 'PacerLeaveLine', fired: false, condition: clock => clock.remainingDistance <= this.config.PacerLeaveLine },
            Bell: { name: 'Bell', fired: false, condition: clock => clock.remainingDistance <= this.config.Bell },
            PacerExit: { name: 'PacerExit', fired: false, condition: clock => clock.remainingDistance <= this.config.PacerExit },
            FinalLap: { name: 'FinalLap', fired: false, condition: clock => clock.remainingDistance <= this.config.FinalLap },
            FinalBack: { name: 'FinalBack', fired: false, condition: clock => clock.remainingDistance <= this.config.FinalBack },
            Finish: { name: 'Finish', fired: false, condition: clock => clock.remainingDistance <= 0 }
        };
    }

    update(pacerDistance, leaderDistance, engine) {
        // The clock follows the pacer until the pacer has actually completed
        // its exit.  On hand-off, never allow the reference distance to move
        // backwards; the leader may still be a few metres behind the pacer.
        if (engine.pacer.state === PACER_STATE.EXITED) {
            this.owner = CLOCK_OWNER.LEADER;
        }

        const candidateDistance = this.owner === CLOCK_OWNER.PACER
            ? pacerDistance
            : leaderDistance;
        this.referenceDistance = Math.max(this.referenceDistance, candidateDistance);

        this.remainingDistance = Math.max(0, this.totalDistance - this.referenceDistance);
        this.currentLap = this.remainingDistance > this.trackLength ? 2 : 1;

        const triggered = [];
        const sequenceOrder = ['PacerLeaveLine', 'Bell', 'PacerExit', 'FinalLap', 'FinalBack', 'Finish'];

        for (const key of sequenceOrder) {
            const ev = this.events[key];
            if (!ev.fired && ev.condition(this, engine)) {
                ev.fired = true;
                triggered.push(ev.name);
                this.firedEventSequence.push(ev.name);

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
        for (const key of Object.keys(this.events)) {
            this.events[key].fired = false;
        }
    }
}

export class PhysicsEngine {
    constructor(lineGroups, lineOffsets = [-18, -6, 6, 18], profile = RACE_CONFIG) {
        this.lineGroups = lineGroups.map(group => [...group]);
        this.lineOffsets = [...lineOffsets];


        // CR-0003B: 3-3-3固定シナリオ検証。
        // AI判断へ進む前に、競輪らしいライン移動・抑え・捲り・抵抗が
        // 1本の決め打ちシナリオとして成立することを確認する。
        this.scriptedScenarioEnabled = true;
        this.scriptedLineGap = 6;

        this.profile = profile;
        this.totalDistance = profile.RACE_DISTANCE;
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
                const baseLaneOffset = this.lineOffsets[lineId % this.lineOffsets.length];
                const initialDistance = -14 - (globalIndex * 17);
                this.riders.push({
                    number,
                    lineId,
                    lineOrder,
                    globalIndex,
                    isLeader: lineOrder === 0,
                    frontRider: null,
                    formationFrontRider: null,
                    baseLaneOffset,
                    initialLaneOffset: -18,
                    initialDistance,
                    targetSpeed: this.profile.FORMATION_SPEED,
                    style: CAR_STYLES[number] ?? CAR_STYLES[1],
                    distance: initialDistance,
                    speed: 0,
                    acceleration: 0,
                    laneOffset: -18,
                    finished: false,
                    finishTime: null,
                    history: []
                });
                globalIndex += 1;
            });
        });

        for (const rider of this.riders) {
            if (!rider.isLeader) {
                rider.frontRider = this.riders.find(candidate =>
                    candidate.lineId === rider.lineId &&
                    candidate.lineOrder === rider.lineOrder - 1
                ) ?? null;
            }
        }

        for (const rider of this.riders) {
            if (rider.globalIndex > 0) {
                rider.formationFrontRider = this.riders.find(candidate =>
                    candidate.globalIndex === rider.globalIndex - 1
                ) ?? null;
            }
        }
    }

    reset() {
        this.isStarted = false;
        this.elapsedTime = 0;
        this.bellRung = false;
        this.currentState = RACE_STATE.POSITION_BATTLE;
        this.ranking = [];
        this.raceClock.reset();
        this.pacer = {
            distance: 0,
            speed: this.profile.FORMATION_SPEED,
            state: PACER_STATE.LEADING,
            laneOffset: -18,
            exitProgress: 0
        };

        for (const rider of this.riders) {
            rider.distance = rider.initialDistance;
            rider.speed = this.profile.FORMATION_SPEED;
            rider.acceleration = 0;
            rider.laneOffset = rider.initialLaneOffset;
            rider.finished = false;
            rider.finishTime = null;
            rider.history = [];
        }
    }

    start() {
        if (this.riders.every(rider => rider.finished)) this.reset();
        this.isStarted = true;
    }

    pause() {
        this.isStarted = false;
    }

    setSpeedScale(scale) {
        this.timeScale = clamp(Number(scale) || 1, 0.25, 4);
    }

    onBell(callback) {
        this.onBellCallback = callback;
    }

    onFinish(callback) {
        this.onFinishCallback = callback;
    }

    _targetSpeedFor(rider) {
        const trackLength = this.profile.TRACK_LENGTH;
        const distOnTrack = wrapTrack(rider.distance, trackLength);
        const quarter = trackLength / 4;
        
        const onCorner = (distOnTrack >= quarter && distOnTrack < quarter * 2) || (distOnTrack >= quarter * 3 && distOnTrack < trackLength);
        const isFinalLap = (this.totalDistance - rider.distance) <= trackLength;
        const finalLapBoost = isFinalLap ? 1.18 : 1;
        const cornerFactor = onCorner ? 0.98 : 1;

        return rider.targetSpeed * finalLapBoost * cornerFactor;
    }

    _updatePacer(dt) {
        if (this.pacer.state === PACER_STATE.EXITED) return;
        this.pacer.distance += this.pacer.speed * dt;

        if (this.raceClock.events.PacerLeaveLine.fired && this.pacer.state === PACER_STATE.LEADING) {
            this.pacer.state = PACER_STATE.EXITING;
        }

        if (this.pacer.state === PACER_STATE.EXITING) {
            const targetProgress = this.raceClock.events.PacerExit.fired ? 1 : 0.7;
            if (this.pacer.exitProgress < targetProgress) {
                this.pacer.exitProgress = Math.min(targetProgress, this.pacer.exitProgress + (0.8 * dt));
            } else if (this.raceClock.events.PacerExit.fired) {
                this.pacer.exitProgress = 1;
            }

            const eased = this.pacer.exitProgress * this.pacer.exitProgress * (3 - 2 * this.pacer.exitProgress);
            this.pacer.laneOffset = -18 - (72 * eased);

            if (this.raceClock.events.PacerExit.fired && this.pacer.exitProgress >= 1) {
                this.pacer.state = PACER_STATE.EXITED;
                this.currentState = RACE_STATE.FINAL;
            }
        }
    }

    _scriptedPhase() {
        const remaining = this.raceClock.remainingDistance;

        if (remaining > 720) return 'FORMATION';
        if (remaining > 640) return 'LINE_789_RISE';
        if (remaining > 560) return 'LINE_456_FOLLOW';
        if (remaining > 400) return 'LINE_789_FRONT';
        if (remaining > 120) return 'LINE_123_ATTACK';
        return 'LINE_456_ATTACK';
    }

    _rider(number) {
        return this.riders.find(rider => rider.number === number) ?? null;
    }

    _followLineFront(rider, fallbackSpeed = this.profile.FORMATION_SPEED, gain = 0.22) {
        const front = rider.frontRider;
        if (!front || front.finished) return fallbackSpeed;

        const actualGap = front.distance - rider.distance;
        const gapError = actualGap - this.scriptedLineGap;
        return front.speed + clamp(gapError * gain, -1.2, 2.0);
    }

    _chaseTarget(rider, targetDistance, baseSpeed, gain = 0.10, minAdjust = -1.0, maxAdjust = 6.0) {
        const error = targetDistance - rider.distance;
        return baseSpeed + clamp(error * gain, minAdjust, maxAdjust);
    }

    _scriptedDecision(rider) {
        const phase = this._scriptedPhase();
        const v = this.profile.FORMATION_SPEED;

        if (phase === 'FORMATION') {
            if (rider.globalIndex === 0) {
                return this._chaseTarget(rider, this.pacer.distance - 14, this.pacer.speed, 0.10, -0.5, 0.5);
            }
            const front = rider.formationFrontRider;
            if (!front) return this.pacer.speed;
            const gapError = (front.distance - rider.distance) - 17;
            return front.speed + clamp(gapError * 0.18, -0.4, 0.4);
        }

        // 同ライン2・3番手は、各フェーズで必ずライン先頭についていく。
        if (!rider.isLeader) {
            return this._followLineFront(rider, v, 0.40);
        }

        const seven = this._rider(7);
        const nine = this._rider(9);
        const one = this._rider(1);
        const three = this._rider(3);

        if (phase === 'LINE_789_RISE') {
            if (rider.lineId === 2) {
                // 7-8-9が外を一気に上がり、ベル手前で誘導員へ並びかける。
                return this._chaseTarget(rider, this.pacer.distance + 10, v + 3.0, 0.12, 0, 8.0);
            }
            return v;
        }

        if (phase === 'LINE_456_FOLLOW') {
            if (rider.lineId === 2) {
                return this._chaseTarget(rider, this.pacer.distance + 30, v + 3.5, 0.14, -0.5, 9.0);
            }
            if (rider.lineId === 1 && nine) {
                // 4-5-6は7-8-9の後ろを目掛けて上昇。
                return this._chaseTarget(rider, nine.distance - 1, v + 5.0, 0.28, -0.5, 12.0);
            }
            return v;
        }

        if (phase === 'LINE_789_FRONT') {
            if (rider.lineId === 2) {
                // 誘導が切れた後は7-8-9が先頭で主導権。
                return v * 1.48;
            }
            if (rider.lineId === 1 && nine) {
                return this._chaseTarget(rider, nine.distance - 7, v * 1.38, 0.18, -1.0, 4.0);
            }
            if (rider.lineId === 0) {
                const six = this._rider(6);
                if (six) return this._chaseTarget(rider, six.distance - 7, v * 1.28, 0.18, -1.0, 3.5);
                return v * 1.16;
            }
        }

        if (phase === 'LINE_123_ATTACK') {
            if (rider.lineId === 0) {
                // 1-2-3が外から捲る。
                return v * 2.18;
            }
            if (rider.lineId === 2) {
                // 7-8-9は先行ラインとして抵抗。
                return v * 1.66;
            }
            // 4-5-6は1-2-3の後ろに入り、最終捲りまで追走する。
            if (three) {
                return this._chaseTarget(rider, three.distance - 7, v * 1.55, 0.20, -1.0, 5.0);
            }
            return v * 1.55;
        }

        // 9時付近から4-5-6が最後の捲り。
        if (phase === 'LINE_456_ATTACK') {
            if (rider.lineId === 1) return v * 3.00;
            if (rider.lineId === 0) return v * 1.80;
            return v * 1.55;
        }

        return v;
    }

    _scriptedLaneTarget(rider) {
        const phase = this._scriptedPhase();

        if (phase === 'FORMATION') return rider.initialLaneOffset;

        if (phase === 'LINE_789_RISE') {
            // CR-0004: ライン先頭だけが先に外へ持ち出す。
            // 2・3番手は前走者の現在レーンを追うことで、
            // 7→8→9の順に同じ軌跡へ入り、3車同時の横移動を防ぐ。
            if (rider.lineId === 2) {
                if (rider.isLeader) return 26;
                return rider.frontRider?.laneOffset ?? rider.initialLaneOffset;
            }
            return -18;
        }

        if (phase === 'LINE_456_FOLLOW') {
            if (rider.lineId === 2) return 26;
            if (rider.lineId === 1) return 8;
            return -18;
        }

        if (phase === 'LINE_789_FRONT') {
            return -18;
        }

        if (phase === 'LINE_123_ATTACK') {
            return rider.lineId === 0 ? 28 : -18;
        }

        if (phase === 'LINE_456_ATTACK') {
            if (rider.lineId === 1) return 30;
            if (rider.lineId === 0) return -8;
            return -18;
        }

        return rider.initialLaneOffset;
    }

    _decision(rider) {
        if (this.scriptedScenarioEnabled) {
            return this._scriptedDecision(rider);
        }

        if (this.currentState === RACE_STATE.POSITION_BATTLE) {
            if (rider.globalIndex === 0) {
                const targetDistance = this.pacer.distance - 14;
                const gapError = targetDistance - rider.distance;
                let desired = this.pacer.speed;
                if (gapError < -0.5) desired -= 0.4;
                else if (gapError > 0.5) desired += 0.4;
                return desired;
            }

            const front = rider.formationFrontRider;
            if (!front) return this.pacer.speed;
            const gapError = (front.distance - rider.distance) - 17;
            let desired = front.speed;
            if (gapError < -0.8) desired -= 0.3;
            else if (gapError > 0.8) desired += 0.3;
            return desired;
        }

        const targetCeiling = this._targetSpeedFor(rider) * 1.25;
        if (rider.isLeader) return this._targetSpeedFor(rider);
        const front = rider.frontRider;
        if (!front) return this.pacer.speed;
        if (front.finished) return targetCeiling;
        const gapError = (front.distance - rider.distance) - 17;
        let desired = front.speed;
        if (gapError < -0.6) desired -= 0.4;
        else if (gapError > 0.6) desired += 0.4;
        return desired;
    }

    _move(rider, desiredSpeed, dt) {
        const previousSpeed = rider.speed;
        const stepAccel = 4.2 * dt;

        if (rider.speed < desiredSpeed) {
            rider.speed = Math.min(desiredSpeed, rider.speed + stepAccel);
        } else if (rider.speed > desiredSpeed) {
            rider.speed = Math.max(desiredSpeed, rider.speed - stepAccel);
        }

        const targetLane = this.scriptedScenarioEnabled
            ? this._scriptedLaneTarget(rider)
            : (this.currentState === RACE_STATE.POSITION_BATTLE ? rider.initialLaneOffset : rider.baseLaneOffset);

        rider.laneOffset += (targetLane - rider.laneOffset) * clamp(2.8 * dt, 0, 1);

        const nextDistance = rider.distance + (rider.speed * dt);
        const minimumGap = 4.5;
        const phase = this.scriptedScenarioEnabled ? this._scriptedPhase() : null;

        if (this.scriptedScenarioEnabled && phase !== 'FORMATION') {
            // シナリオ開始後は他ラインを追い越せる。同ライン内だけ最低車間を守る。
            const front = rider.frontRider;
            if (!rider.isLeader && front && !front.finished) {
                rider.distance = Math.min(nextDistance, front.distance - minimumGap);
                if (rider.distance === front.distance - minimumGap && rider.speed > front.speed) {
                    rider.speed = front.speed;
                }
            } else {
                rider.distance = nextDistance;
            }
        } else if (this.currentState === RACE_STATE.POSITION_BATTLE) {
            if (rider.globalIndex === 0) {
                rider.distance = nextDistance;
            } else {
                const front = rider.formationFrontRider;
                if (front) {
                    rider.distance = Math.min(nextDistance, front.distance - minimumGap);
                    if (rider.distance === front.distance - minimumGap && rider.speed > front.speed) {
                        rider.speed = front.speed;
                    }
                } else {
                    rider.distance = nextDistance;
                }
            }
        } else {
            const front = rider.frontRider;
            if (!rider.isLeader && front && !front.finished) {
                rider.distance = Math.min(nextDistance, front.distance - minimumGap);
                if (rider.distance === front.distance - minimumGap && rider.speed > front.speed) {
                    rider.speed = front.speed;
                }
            } else {
                rider.distance = nextDistance;
            }
        }

        rider.acceleration = (rider.speed - previousSpeed) / Math.max(dt, 1e-6);
    }

    _recordFinish(rider) {
        rider.distance = this.totalDistance;
        rider.finished = true;
        rider.finishTime = this.elapsedTime;
        this.ranking.push({
            rank: 0,
            number: rider.number,
            lineId: rider.lineId,
            time: rider.finishTime,
            margin: ''
        });
    }

    _finalizeRanking() {
        this.ranking.sort((a, b) => a.time - b.time || a.number - b.number);
        const winnerTime = this.ranking[0]?.time ?? 0;

        this.ranking.forEach((item, index) => {
            item.rank = index + 1;
            if (index === 0) {
                item.margin = '先頭';
                return;
            }

            const meters = (item.time - winnerTime) * 10.5;
            if (meters < 0.05) item.margin = '同着';
            else if (meters < 0.12) item.margin = 'ハナ';
            else if (meters < 0.25) item.margin = 'アタマ';
            else if (meters < 0.4) item.margin = 'タイヤ';
            else if (meters < 0.7) item.margin = '1/2車身';
            else if (meters < 1.1) item.margin = '1車身';
            else if (meters < 2.2) item.margin = '2車身';
            else item.margin = `${meters.toFixed(1)}車身`;
        });
    }

    _recordHistory() {
        const sorted = [...this.riders].sort((a, b) => b.distance - a.distance);
        const positions = new Map(sorted.map((rider, index) => [rider.number, index + 1]));

        for (const rider of this.riders) {
            rider.history.push({
                time: this.elapsedTime,
                distance: rider.distance,
                speed: rider.speed,
                acceleration: rider.acceleration,
                laneOffset: rider.laneOffset,
                position: positions.get(rider.number),
                frontNumber: rider.frontRider?.number ?? null,
                gap: rider.frontRider ? rider.frontRider.distance - rider.distance : null
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

                const desiredSpeed = this._decision(rider);
                this._move(rider, desiredSpeed, stepDt);

                if (previousDistance < this.totalDistance && rider.distance >= this.totalDistance) {
                    this._recordFinish(rider);
                }
            }

            const leader = this.riders.reduce((max, r) => r.distance > max.distance ? r : max, this.riders[0]);
            const leaderDistance = leader ? leader.distance : 0;

            const triggeredEvents = this.raceClock.update(this.pacer.distance, leaderDistance, this);

            if (triggeredEvents.includes('Bell')) {
                this.bellRung = true;
                this.onBellCallback?.();
            }
        }

        this._recordHistory();

        if (this.riders.every(rider => rider.finished)) {
            this.isStarted = false;
            this.currentState = RACE_STATE.FINISHED;
            this._finalizeRanking();
            this.onFinishCallback?.(this.ranking.map(item => ({ ...item })));
        }
    }

    getDiagnostics() {
        const gaps = this.riders
            .map(rider => {
                const front = this.currentState === RACE_STATE.POSITION_BATTLE
                    ? rider.formationFrontRider
                    : rider.frontRider;
                return { rider, front };
            })
            .filter(({ rider, front }) => front && !rider.finished && !front.finished)
            .map(({ rider, front }) => ({
                number: rider.number,
                frontNumber: front.number,
                gap: front.distance - rider.distance
            }));

        return {
            gaps,
            minGap: gaps.length ? Math.min(...gaps.map(item => item.gap)) : null,
            maxGap: gaps.length ? Math.max(...gaps.map(item => item.gap)) : null,
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