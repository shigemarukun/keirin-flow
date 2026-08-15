const TRACK_LENGTH = 400;
const FINISH_LINE_PHASE = 50;

const wrapTrackDistance = distance =>
    ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;


/**
 * CR-0001B
 *
 * 論理距離400mを、画面上の実際の経路長
 * （直線 + 半円コーナー）の比率に合わせて配分する。
 *
 * 既存の座標系・周回方向・FINISH_LINE_PHASE・laneOffset・角度式は維持する。
 */
export function getTrackPoint(
    { cx, cy, halfStraight, radius },
    absoluteDistance,
    laneOffset = 0
) {
    // 論理上の0m / 400m地点をホームストレッチ中央へ位相調整
    const d = wrapTrackDistance(
        absoluteDistance + FINISH_LINE_PHASE
    );

    const r = radius + laneOffset;


    // =========================================================
    // CR-0001B
    //
    // 旧仕様:
    //   直線     100m
    //   コーナー 100m
    //   直線     100m
    //   コーナー 100m
    //
    // 新仕様:
    //   画面上の経路長比率に合わせて400mを配分
    // =========================================================

    const straightPx = 2 * halfStraight;
    const cornerPx = Math.PI * radius;

    const totalPx =
        (2 * straightPx)
        + (2 * cornerPx);

    const straightDist =
        TRACK_LENGTH
        * straightPx
        / totalPx;

    const cornerDist =
        TRACK_LENGTH
        * cornerPx
        / totalPx;


    // 各区間の境界
    const b1 = straightDist;
    const b2 = b1 + cornerDist;
    const b3 = b2 + straightDist;


    // =========================================================
    // 第1区間：下側直線
    // =========================================================
    if (d < b1) {
        const p =
            d / straightDist;

        return {
            x:
                cx
                - halfStraight
                + (2 * halfStraight * p),

            y:
                cy + r,

            angle:
                0
        };
    }


    // =========================================================
    // 第2区間：右側コーナー
    // =========================================================
    if (d < b2) {
        const p =
            (d - b1)
            / cornerDist;

        const theta =
            Math.PI / 2
            - (Math.PI * p);

        return {
            x:
                cx
                + halfStraight
                + (Math.cos(theta) * r),

            y:
                cy
                + (Math.sin(theta) * r),

            angle:
                theta - Math.PI / 2
        };
    }


    // =========================================================
    // 第3区間：上側直線
    // =========================================================
    if (d < b3) {
        const p =
            (d - b2)
            / straightDist;

        return {
            x:
                cx
                + halfStraight
                - (2 * halfStraight * p),

            y:
                cy - r,

            angle:
                Math.PI
        };
    }


    // =========================================================
    // 第4区間：左側コーナー
    // =========================================================
    const p =
        (d - b3)
        / cornerDist;

    const theta =
        -Math.PI / 2
        - (Math.PI * p);

    return {
        x:
            cx
            - halfStraight
            + (Math.cos(theta) * r),

        y:
            cy
            + (Math.sin(theta) * r),

        angle:
            theta - Math.PI / 2
    };
}


export class UIRenderer {

    constructor(canvasId) {

        this.canvas =
            document.getElementById(canvasId);

        if (!this.canvas) {
            throw new Error(
                `Canvas #${canvasId} not found`
            );
        }

        this.ctx =
            this.canvas.getContext('2d');

        if (!this.ctx) {
            throw new Error(
                '2D canvas context is unavailable'
            );
        }


        this.cx =
            this.canvas.width / 2;

        this.cy =
            this.canvas.height / 2;


        this.halfStraight = 140;
        this.radius = 200;


        this.trackGeometry = {
            cx: this.cx,
            cy: this.cy,
            halfStraight: this.halfStraight,
            radius: this.radius
        };
    }


    getBankCoordinates(
        distance,
        laneOffset = 0
    ) {
        return getTrackPoint(
            this.trackGeometry,
            distance,
            laneOffset
        );
    }


    drawTrack(
        offset,
        width,
        color
    ) {
        const c = this.ctx;

        c.beginPath();

        for (
            let distance = 0;
            distance <= TRACK_LENGTH;
            distance += 1
        ) {
            const point =
                this.getBankCoordinates(
                    distance,
                    offset
                );

            if (distance === 0) {
                c.moveTo(
                    point.x,
                    point.y
                );
            } else {
                c.lineTo(
                    point.x,
                    point.y
                );
            }
        }

        c.closePath();

        c.lineWidth = width;
        c.strokeStyle = color;
        c.lineJoin = 'round';
        c.lineCap = 'round';

        c.stroke();
    }


    drawBank() {

        const c = this.ctx;

        c.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );


        // バンク本体
        this.drawTrack(
            0,
            100,
            '#334155'
        );


        // 内側ライン
        this.drawTrack(
            -50,
            2,
            '#64748b'
        );


        // 外側ライン
        this.drawTrack(
            50,
            2,
            '#64748b'
        );


        // ゴールライン
        const inside =
            this.getBankCoordinates(
                0,
                -50
            );

        const outside =
            this.getBankCoordinates(
                0,
                50
            );


        c.beginPath();

        c.moveTo(
            inside.x,
            inside.y
        );

        c.lineTo(
            outside.x,
            outside.y
        );

        c.lineWidth = 4;
        c.strokeStyle = '#f8fafc';

        c.stroke();
    }


    drawMarker(
        x,
        y,
        radius,
        background,
        border,
        label,
        textColor,
        fontSize = 11
    ) {
        const c = this.ctx;

        c.beginPath();

        c.arc(
            x,
            y,
            radius,
            0,
            Math.PI * 2
        );

        c.fillStyle =
            background;

        c.fill();

        c.lineWidth = 2;
        c.strokeStyle = border;

        c.stroke();

        c.fillStyle =
            textColor;

        c.font =
            `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

        c.textAlign =
            'center';

        c.textBaseline =
            'middle';

        c.fillText(
            label,
            x,
            y
        );
    }


    drawLineLinks(state) {
        const c = this.ctx;
        const byNumber = new Map(state.riders.map(r => [r.number, r]));

        for (const line of state.lines ?? []) {
            const members = line.members
                .map(number => byNumber.get(number))
                .filter(rider => rider && !rider.finished);

            if (members.length < 2) continue;

            c.beginPath();

            members.forEach((rider, index) => {
                const point = this.getBankCoordinates(
                    rider.renderDistance ?? rider.distance,
                    rider.renderLaneOffset ?? rider.laneOffset
                );

                if (index === 0) c.moveTo(point.x, point.y);
                else c.lineTo(point.x, point.y);
            });

            c.lineWidth = 1.2;
            c.strokeStyle = 'rgba(226,232,240,0.24)';
            c.lineJoin = 'round';
            c.lineCap = 'round';
            c.stroke();
        }
    }


    drawRiders(state) {

        // =====================================================
        // 誘導員
        // CR-0016: pacer rendering uses the same 1D distance + laneOffset
        // coordinate pipeline as riders. EXITING is therefore a real eased
        // lane change to the outer retreat corridor, not a canvas teleport.
        // =====================================================
        if (state.pacer.state !== 'EXITED') {
            const point =
                this.getBankCoordinates(
                    state.pacer.distance,
                    state.pacer.laneOffset
                );

            this.drawMarker(
                point.x,
                point.y,
                6.2,
                '#e2e8f0',
                '#0f172a',
                '誘',
                '#0f172a',
                8
            );
        }


        this.drawLineLinks(state);

        const orderedRiders =
            [...state.riders]
                .sort(
                    (a, b) =>
                        a.globalIndex
                        - b.globalIndex
                );


        for (
            const rider
            of orderedRiders
        ) {

            // Finished riders leave the bank canvas; result order is shown
            // in the dedicated ranking panel. This prevents a finish-line pile.
            if (rider.finished) continue;

            const point =
                this.getBankCoordinates(
                    rider.renderDistance ?? rider.distance,
                    rider.renderLaneOffset ?? rider.laneOffset
                );


            this.drawMarker(
                point.x,
                point.y,
                5.2,
                rider.style.background,
                '#ffffff',
                String(rider.number),
                rider.style.text,
                7.2
            );
        }
    }


    updateUI(state) {

        const lapCounter =
            document.getElementById(
                'lap-counter'
            );

        const raceStatus =
            document.getElementById(
                'race-status'
            );

        const gapStatus =
            document.getElementById(
                'gap-status'
            );

        const resultList =
            document.getElementById(
                'result-list'
            );

        const protocolStatus =
            document.getElementById(
                'protocol-status'
            );


        const remaining =
            Math.max(
                0,
                Math.ceil(
                    state.raceClock
                        ?.remainingDistance
                    ?? state.totalDistance
                )
            );


        const currentLap =
            state.raceClock
                ?.currentLap
            ?? (
                remaining > TRACK_LENGTH
                    ? 2
                    : 1
            );


        const lap =
            currentLap > 1
                ? '残り2周'
                : '最終周';


        if (lapCounter) {

            lapCounter.textContent =
                `${lap} / 残り${remaining}m`;
        }


        if (raceStatus) {

            if (
                state.ranking.length
                === state.riders.length
            ) {

                raceStatus.textContent =
                    'FINISHED';

                raceStatus.style.color =
                    '#f59e0b';


            } else if (
                state.isStarted
            ) {

                raceStatus.textContent =
                    state.bellRung
                        ? 'BELL / FINAL LAP'
                        : 'RACING...';

                raceStatus.style.color =
                    state.bellRung
                        ? '#f59e0b'
                        : '#22c55e';


            } else {

                raceStatus.textContent =
                    state.elapsedTime > 0
                        ? 'PAUSED'
                        : 'PRE-RACE';

                raceStatus.style.color =
                    '#38bdf8';
            }
        }


        if (gapStatus) {

            const minGap =
                state.diagnostics.minGap;

            const maxGap =
                state.diagnostics.maxGap;


            gapStatus.textContent =
                minGap == null
                    ? '車間: --'
                    : `車間: ${minGap.toFixed(1)}〜${maxGap.toFixed(1)}m`;
        }


        if (protocolStatus) {
            protocolStatus.textContent = `Scenario: ${state.scenario?.currentPhase ?? 'PHASE_1_PACER_CUT'}`;
        }

        this.renderDecisionLog(state.decisionLogs ?? []);

        if (resultList) {

            resultList.innerHTML =
                state.ranking.length
                    ? state.ranking
                        .map(
                            item =>
                                `<li><strong>${item.rank}着 ${item.number}番</strong><span>${item.margin}</span></li>`
                        )
                        .join('')
                    : '<li class="empty-result">レース終了後に表示</li>';
        }
    }


    renderTenkaiSummary(prediction) {
        const container = document.getElementById('tenkai-summary-ui');
        if (!container || !prediction) return;

        const responseLabel = prediction.frontResponse === 'TSUPPARI'
            ? '突っ張り想定'
            : prediction.frontResponse === 'YIELD'
                ? '出させて引く想定'
                : '抑え・様子見想定';

        container.innerHTML = `
            <div class="tenkai-formation">${prediction.initialFormation}</div>
            <div class="tenkai-grid">
                <div class="tenkai-row"><span class="tenkai-key">誘導切り</span><span class="tenkai-value">${prediction.pacerCut.leaderNumber}番 / ${prediction.pacerCut.lineId}</span></div>
                <div class="tenkai-row"><span class="tenkai-key">前受け対応</span><span class="tenkai-value">${prediction.initialFrontLeaderNumber}番：${responseLabel}</span></div>
                <div class="tenkai-row"><span class="tenkai-key">主導権</span><span class="tenkai-value">${prediction.initiative.leaderNumber}番 / ${prediction.initiative.lineId}</span></div>
                <div class="tenkai-row"><span class="tenkai-key">捲り候補</span><span class="tenkai-value">${prediction.makuriCandidate ? `${prediction.makuriCandidate.leaderNumber}番 / ${prediction.makuriCandidate.lineId}` : '--'}</span></div>
            </div>
            <ul class="tenkai-points">${prediction.points.map(point => `<li>${point}</li>`).join('')}</ul>
        `;
    }

    renderDecisionLog(logs) {
        const container = document.getElementById('decision-log-ui');
        if (!container) return;
        if (!logs.length) {
            container.innerHTML = '<p class="empty-result">START後にAI判断を表示</p>';
            return;
        }
        const latest = logs.slice(-18).reverse();
        container.innerHTML = latest.map(item => {
            const rider = item.riderNumber == null ? 'SYSTEM' : `${item.riderNumber}番`;
            return `<div class="decision-entry"><span class="decision-meta">残${Math.max(0, Math.round(item.remaining))}m</span><strong>[${rider}]</strong> ${item.message}</div>`;
        }).join('');
    }

    renderLineList(
        lineGroups
    ) {

        const container =
            document.getElementById(
                'line-list-ui'
            );


        if (!container) {
            return;
        }


        container.innerHTML =
            lineGroups
                .map(
                    (group, index) => `
                        <div class="line-row">
                            <span class="line-name">ライン${index + 1}</span>
                            <span class="line-members">${group.join(' - ')}</span>
                        </div>
                    `
                )
                .join('');
    }

    renderRaceSetup(setup) {
        const container = document.getElementById('line-list-ui');
        if (!container) return;

        const lineRows = (setup?.lines ?? []).map((line, index) => `
            <div class="line-row">
                <span class="line-name">${line.id ?? `ライン${index + 1}`}</span>
                <span class="line-members">${line.members.join(' - ')}</span>
            </div>
        `);

        const soloNumbers = Object.entries(setup?.riders ?? {})
            .filter(([, rider]) => rider?.solo === true)
            .map(([number]) => Number(number))
            .sort((a, b) => a - b);

        const soloRows = soloNumbers.map(number => `
            <div class="line-row">
                <span class="line-name">単騎</span>
                <span class="line-members">${number}</span>
            </div>
        `);

        container.innerHTML = [...lineRows, ...soloRows].join('');
    }
}