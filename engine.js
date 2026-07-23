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

const PACER_STATE = Object.freeze({
    LEADING: 'LEADING',
    EXITING: 'EXITING',
    EXITED: 'EXITED'
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap400 = distance => ((distance % 400) + 400) % 400;

export class PhysicsEngine {
    constructor(lineGroups, lineOffsets = [-18, -6, 6, 18]) {
        this.lineGroups = lineGroups.map(group => [...group]);
        this.lineOffsets = [...lineOffsets];
        this.totalDistance = 800;
        this.timeScale = 1;
        this.onBellCallback = null;
        this.onFinishCallback = null;
        this.PACER_STATE = PACER_STATE;
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
                    baseLaneOffset,
                    initialLaneOffset: -18,
                    initialDistance,
                    targetSpeed: 10.5 + ((number % 3) * 0.08),
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
    }

    reset() {
        this.isStarted = false;
        this.elapsedTime = 0;
        this.bellRung = false;
        this.ranking = [];
        this.pacer = {
            distance: 0,
            speed: 10.5,
            state: PACER_STATE.LEADING,
            laneOffset: -18
        };

        for (const rider of this.riders) {
            rider.distance = rider.initialDistance;
            rider.speed = 0;
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
        const dist400 = wrap400(rider.distance);
        const onCorner = (dist400 >= 100 && dist400 < 200) || (dist400 >= 300 && dist400 < 400);
        const finalLapBoost = rider.distance >= 400 ? 1.18 : 1;
        const cornerFactor = onCorner ? 0.98 : 1;
        return rider.targetSpeed * finalLapBoost * cornerFactor;
    }

    _updatePacer(dt) {
        if (this.pacer.state === PACER_STATE.EXITED) return;

        this.pacer.distance += this.pacer.speed * dt;

        if (!this.bellRung && this.pacer.distance >= 400) {
            this.bellRung = true;
            this.pacer.state = PACER_STATE.EXITING;
            this.onBellCallback?.();
        }

        if (this.pacer.state === PACER_STATE.EXITING) {
            const progress = clamp((this.pacer.distance - 400) / 40, 0, 1);
            const eased = progress * progress * (3 - 2 * progress);
            this.pacer.laneOffset = -18 + (72 * eased);
            if (progress >= 1) this.pacer.state = PACER_STATE.EXITED;
        }
    }

    _followPacer(rider, dt) {
        // Formation phase: the pacer and all nine riders move as one rigid queue.
        // Each rider is placed directly on the shared distance axis, so cornering
        // cannot introduce spring lag or amplify spacing errors down the line.
        const formationGap = 17;
        rider.distance = this.pacer.distance - 14 - (rider.globalIndex * formationGap);
        rider.speed = this.pacer.speed;
        rider.acceleration = 0;
        rider.laneOffset = rider.initialLaneOffset;
    }

    _updateLeader(rider, dt) {
        const targetSpeed = this._targetSpeedFor(rider);
        const previousSpeed = rider.speed;
        const accel = rider.speed < targetSpeed ? 3.5 : -3;
        rider.speed += accel * dt;

        if ((accel > 0 && rider.speed > targetSpeed) || (accel < 0 && rider.speed < targetSpeed)) {
            rider.speed = targetSpeed;
        }

        rider.distance += rider.speed * dt;
        rider.acceleration = (rider.speed - previousSpeed) / Math.max(dt, 1e-6);
    }

    _updateFollower(rider, dt) {
        const front = rider.frontRider;
        if (!front) return;

        const previousSpeed = rider.speed;
        const targetCeiling = this._targetSpeedFor(rider) * 1.25;

        // Once the front rider crosses the line, the follower must be allowed to
        // cross it too. Keeping a 5m collision barrier against a clamped 800m
        // position would dead-lock every follower at 795m.
        if (front.finished) {
            const finishAcceleration = rider.speed < targetCeiling ? 2.4 : -2.0;
            rider.speed = clamp(rider.speed + (finishAcceleration * dt), 0, targetCeiling);
            rider.distance += rider.speed * dt;
            rider.acceleration = (rider.speed - previousSpeed) / Math.max(dt, 1e-6);
            return;
        }

        const idealGap = 17 + Math.min(3, front.speed * 0.2);
        const actualGap = front.distance - rider.distance;
        const gapError = actualGap - idealGap;
        const relativeSpeed = front.speed - rider.speed;

        // Bounded damped car-following controller. The internal 120Hz substeps and
        // acceleration limits keep the line stable even at 3x playback speed.
        const requestedAcceleration = (gapError * 1.35) + (relativeSpeed * 2.25);
        const acceleration = clamp(requestedAcceleration, -4.5, 4.2);
        rider.speed = clamp(rider.speed + acceleration * dt, 0, targetCeiling);

        const nextDistance = rider.distance + (rider.speed * dt);
        const minimumGap = 5;
        rider.distance = Math.min(nextDistance, front.distance - minimumGap);
        if (rider.distance === front.distance - minimumGap && rider.speed > front.speed) {
            rider.speed = front.speed;
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

                if (this.pacer.state !== PACER_STATE.EXITED) {
                    this._followPacer(rider, stepDt);
                } else {
                    rider.laneOffset += (rider.baseLaneOffset - rider.laneOffset) * clamp(2.6 * stepDt, 0, 1);
                    if (rider.isLeader) this._updateLeader(rider, stepDt);
                    else this._updateFollower(rider, stepDt);
                }

                if (previousDistance < this.totalDistance && rider.distance >= this.totalDistance) {
                    this._recordFinish(rider);
                }
            }
        }

        this._recordHistory();

        if (this.riders.every(rider => rider.finished)) {
            this.isStarted = false;
            this._finalizeRanking();
            this.onFinishCallback?.(this.ranking.map(item => ({ ...item })));
        }
    }

    getDiagnostics() {
        const gaps = this.riders
            .filter(rider => rider.frontRider && !rider.finished && !rider.frontRider.finished)
            .map(rider => ({
                number: rider.number,
                frontNumber: rider.frontRider.number,
                gap: rider.frontRider.distance - rider.distance
            }));

        return {
            gaps,
            minGap: gaps.length ? Math.min(...gaps.map(item => item.gap)) : null,
            maxGap: gaps.length ? Math.max(...gaps.map(item => item.gap)) : null
        };
    }

    getState() {
        return {
            riders: this.riders,
            pacer: this.pacer,
            ranking: this.ranking,
            isStarted: this.isStarted,
            elapsedTime: this.elapsedTime,
            totalDistance: this.totalDistance,
            bellRung: this.bellRung,
            diagnostics: this.getDiagnostics()
        };
    }
}
