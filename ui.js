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
    { cx, cy, halfStraight, radius, length = TRACK_LENGTH },
    absoluteDistance,
    laneOffset = 0
) {
    // 333・500バンクも同じ形で描き、距離だけ周長に合わせて割り当てる
    const TRACK_LENGTH_ = length;
    const wrapLap = distance => ((distance % TRACK_LENGTH_) + TRACK_LENGTH_) % TRACK_LENGTH_;
    // 論理上の0m / 400m地点をホームストレッチ中央へ位相調整
    const d = wrapLap(
        absoluteDistance + FINISH_LINE_PHASE * TRACK_LENGTH_ / TRACK_LENGTH
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
        TRACK_LENGTH_
        * straightPx
        / totalPx;

    const cornerDist =
        TRACK_LENGTH_
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


    // シミュレーションの走路位置 (内 -18 〜 外 44) を、画面のバンク幅いっぱいに広げて描く。
    // そのままだと隣の走路の選手どうしが画面上で重なって見えるため。
    riderLaneToScreen(laneOffset) {
        return -38 + (laneOffset + 18) * 1.35;
    }

    // 画面に描く位置 (前後): 計算では自転車1台分(約2.6m)の車間で走っているが、そのまま描くと
    // 選手の丸が重なって団子に見える。先頭の選手は本当の位置に置き、後ろへ順に、
    // 「詰まって付いている車間」だけを広げて描く (離れている車間・千切れはそのままの差で見せる)
    displayDistances(state) {
        const S = 2.5, tight = 3.4; // 広げる倍率 / 「付いている」とみなす車間 (m)
        const live = state.riders.filter(r => !r.finished).sort((a, b) => b.distance - a.distance);
        const out = new Map(state.riders.filter(r => r.finished).map(r => [r.number, r.distance]));
        let prevTrue = null, prevShown = null;
        for (const r of live) {
            if (prevTrue == null) { out.set(r.number, r.distance); }
            else {
                const gap = prevTrue - r.distance;
                out.set(r.number, prevShown - (gap + (S - 1) * Math.min(gap, tight)));
            }
            prevTrue = r.distance; prevShown = out.get(r.number);
        }
        this._shown = out;
        return out;
    }

    shownDistance(rider) {
        return this._shown?.get(rider.number) ?? rider.distance;
    }

    setTrackLength(length) {
        this.trackGeometry = { ...this.trackGeometry, length };
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
            distance <= (this.trackGeometry.length ?? TRACK_LENGTH);
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


    // ---------- カメラ (選手の集団を追って寄る) ----------
    // スマホの小さな画面でもレースの攻防が見えるよう、走っている集団にあわせて寄って追いかける。
    // 「全体を見る」に切り替えると、いつもバンク全体を映す。
    setCameraFollow(on) { this.cameraFollow = !!on; }

    updateCamera(state, dt = 1 / 60) {
        const W = this.canvas.width, H = this.canvas.height;
        let target = { x: W / 2, y: H / 2, z: 1 };
        const live = (state?.riders ?? []).filter(r => !r.finished);
        if (this.cameraFollow !== false && state?.isStarted && live.length >= 2) {
            this.displayDistances(state);
            const pts = live.map(r => this.getBankCoordinates(this.shownDistance(r), this.riderLaneToScreen(r.laneOffset)));
            if (state.pacer && state.pacer.state === 'LEADING') pts.push(this.getBankCoordinates(state.pacer.distance, this.riderLaneToScreen(-18)));
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            const pad = 110;
            const z = Math.max(1, Math.min(2.3, W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2)));
            target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z };
        }
        // 急に動かず、なめらかに追う
        const k = 1 - Math.exp(-Math.max(0, dt) / 0.45);
        const cam = this.cam ?? (this.cam = { ...target });
        cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k; cam.z += (target.z - cam.z) * k;
        // 画面の外 (バンクの外の何もないところ) を映しすぎない
        const halfW = W / 2 / cam.z, halfH = H / 2 / cam.z;
        cam.x = Math.min(W - halfW, Math.max(halfW, cam.x)); cam.y = Math.min(H - halfH, Math.max(halfH, cam.y));
    }

    applyCamera() {
        const c = this.ctx, cam = this.cam;
        c.setTransform(1, 0, 0, 1, 0, 0);
        if (!cam) return;
        const W = this.canvas.width, H = this.canvas.height;
        c.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.z * cam.x, H / 2 - cam.z * cam.y);
    }

    // 寄っているときは、選手の丸を寄った分ほどは大きくしない (隣の選手と重ならないように)
    markerScale() { return 1 / Math.sqrt(this.cam?.z ?? 1); }

    drawBank() {

        const c = this.ctx;

        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );
        this.applyCamera();


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
        fontSize = 11,
        headingAngle = null
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

        c.lineWidth = border === '#ffffff' || border === '#f8fafc' ? 2 : 3.5;
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

        // 進行方向: 円の外側に小さな三角を付ける (番号の上に線を引かない)。
        // 車線変更中は少し傾くので、どちらへ動いているかも分かる。
        if (Number.isFinite(headingAngle)) {
            const tipX = x + Math.cos(headingAngle) * (radius + 6);
            const tipY = y + Math.sin(headingAngle) * (radius + 6);
            const baseX = x + Math.cos(headingAngle) * (radius + 1);
            const baseY = y + Math.sin(headingAngle) * (radius + 1);
            const side = headingAngle + Math.PI / 2;
            c.beginPath();
            c.moveTo(tipX, tipY);
            c.lineTo(baseX + Math.cos(side) * 4, baseY + Math.sin(side) * 4);
            c.lineTo(baseX - Math.cos(side) * 4, baseY - Math.sin(side) * 4);
            c.closePath();
            c.fillStyle = 'rgba(255, 255, 255, 0.75)';
            c.fill();
        }
    }


    drawRiders(state) {

        // =====================================================
        // 誘導員
        //
        // LEADING:
        //   従来どおりEngineのdistance / laneOffsetを使用。
        //
        // EXITING:
        //   laneOffsetの符号には依存せず、
        //   基準走行位置からCanvas中央方向へ直接退避。
        //
        // EXITED:
        //   描画しない。
        // =====================================================

        if (
            state.pacer.state !== 'EXITED'
        ) {

            let point;


            // -------------------------------------------------
            // 退避中
            // -------------------------------------------------
            if (
                state.pacer.state === 'EXITING'
            ) {

                // 誘導員の通常走行基準レーン
                // Engine初期値と同じ -18 を基準にする
                const basePoint =
                    this.getBankCoordinates(
                        state.pacer.distance,
                        this.riderLaneToScreen(-18)
                    );


                // 現在地点 → Canvas中央方向
                const dx =
                    this.cx - basePoint.x;

                const dy =
                    this.cy - basePoint.y;


                const length =
                    Math.sqrt(
                        (dx * dx)
                        + (dy * dy)
                    ) || 1;


                // 内側方向の単位ベクトル
                const inwardX =
                    dx / length;

                const inwardY =
                    dy / length;


                // Engineに実在するexitProgress
                // 0.0 → 1.0
                const progress =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            state.pacer.exitProgress
                        )
                    );


                // 最大120px、バンク中央方向へ退避
                const exitAmount =
                    progress * 120;


                point = {
                    x:
                        basePoint.x
                        + (inwardX * exitAmount),

                    y:
                        basePoint.y
                        + (inwardY * exitAmount),

                    angle:
                        basePoint.angle
                };


            // -------------------------------------------------
            // 通常先導中
            // -------------------------------------------------
            } else {

                point =
                    this.getBankCoordinates(
                        state.pacer.distance,
                        this.riderLaneToScreen(state.pacer.laneOffset)
                    );
            }


            this.drawMarker(
                point.x,
                point.y,
                10,
                '#64748b',
                '#f8fafc',
                '誘',
                '#ffffff',
                10
            );
        }


        // =====================================================
        // 選手
        // =====================================================

        this.displayDistances(state);

        // 仕掛けている選手には、後ろに流れる光の尾を付ける (捲り・カマシ・直線の伸びが一目で分かるように)
        const c = this.ctx;
        for (const rider of state.riders) {
            if (rider.finished || !['ATTACK', 'SWITCH_TO_SELF_POWER', 'FINAL_SPRINT', 'MOVE_UP'].includes(rider.action)) continue;
            const d = this.shownDistance(rider), lane = this.riderLaneToScreen(rider.laneOffset);
            const len = Math.min(14, Math.max(4, (rider.speed - 14) * 2.2));
            c.save();
            c.lineCap = 'round';
            for (let k = 0; k < 6; k++) {
                const a0 = this.getBankCoordinates(d - (k / 6) * len, lane), a1 = this.getBankCoordinates(d - ((k + 1) / 6) * len, lane);
                c.beginPath(); c.moveTo(a0.x, a0.y); c.lineTo(a1.x, a1.y);
                c.strokeStyle = rider.action === 'FINAL_SPRINT' ? `rgba(250, 204, 21, ${0.55 * (1 - k / 6)})` : `rgba(56, 189, 248, ${0.6 * (1 - k / 6)})`;
                c.lineWidth = 9 * this.markerScale() * (1 - k / 8);
                c.stroke();
            }
            c.restore();
        }

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

            const point =
                this.getBankCoordinates(
                    this.shownDistance(rider),
                    this.riderLaneToScreen(rider.laneOffset)
                );


            // 縁の色で状態を見せる: 仕掛け=水色 / 踏み合い=橙 / ブロック=赤 / 脚切れ=灰
            const ring =
                rider.action === 'FULL_CONTEST' ? '#f97316'
                : rider.action === 'BLOCK' ? '#ef4444'
                : ['ATTACK', 'SWITCH_TO_SELF_POWER', 'MOVE_UP'].includes(rider.action) ? '#38bdf8'
                : (rider.energy ?? 1) < 0.15 || rider.action === 'FADE' ? '#64748b'
                : '#ffffff';

            this.drawMarker(
                point.x,
                point.y,
                11 * this.markerScale(),
                rider.style.background,
                ring,
                String(rider.number),
                rider.style.text,
                12 * this.markerScale(),
                point.angle + (rider.visualAngleOffset ?? 0)
            );
        }
    }


    // 実況テロップで話題になっている選手に、光る輪を付ける
    drawSpotlight(state, number, strength = 1) {
        const rider = state.riders.find(r => r.number === number);
        if (!rider) return;
        const p = this.getBankCoordinates(this.shownDistance(rider), this.riderLaneToScreen(rider.laneOffset));
        const c = this.ctx;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
        c.save();
        c.beginPath();
        c.arc(p.x, p.y, (17 + pulse * 4) * this.markerScale(), 0, Math.PI * 2);
        c.strokeStyle = `rgba(250, 204, 21, ${0.55 * strength + 0.35 * pulse * strength})`;
        c.lineWidth = 3;
        c.stroke();
        c.restore();
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
                remaining > (state.trackLength ?? TRACK_LENGTH)
                    ? 2
                    : 1
            );


        const lap =
            currentLap > 1
                ? '残り2周'
                : '最終周';


        if (lapCounter) {

            // 場面 (周回・赤板・打鐘・最終周…) と残りの距離。場面は400バンクに直した距離で決める
            const r4 = remaining / (state.lapScale ?? 1);
            const scene = r4 > 1150 ? '周回' : r4 > 770 ? '青板' : r4 > 600 ? '赤板' : r4 > 400 ? '打鐘' : r4 > 0 ? '最終周' : 'ゴール';
            lapCounter.textContent =
                `${state.isStarted || remaining < (state.totalDistance ?? Infinity) ? `${scene} ・ ` : ''}残り${remaining}m`;
        }


        if (raceStatus) {

            if (
                state.ranking.length
                === state.riders.length
            ) {

                raceStatus.textContent =
                    'ゴール';

                raceStatus.style.color =
                    '#f59e0b';


            } else if (
                state.isStarted
            ) {

                raceStatus.textContent =
                    'レース中';

                raceStatus.style.color =
                    state.bellRung
                        ? '#f59e0b'
                        : '#22c55e';


            } else {

                raceStatus.textContent =
                    state.elapsedTime > 0
                        ? '一時停止中'
                        : 'スタート前';

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
            protocolStatus.textContent = state.mode === 'TEACHER'
                ? `教材シナリオ: ${state.scenario?.currentPhase ?? 'PHASE_1_PACER_CUT'}`
                : 'AI: 各選手が自律判断';
        }

        this.renderDecisionLog(state.decisionLogs ?? []);

        if (resultList) {

            resultList.innerHTML =
                state.ranking.length
                    ? [...state.ranking].sort((a, b) => a.time - b.time)
                        .map(
                            (item, index) => {
                                const name = state.setup?.meta?.names?.[item.number];
                                const safe = name ? String(name).replace(/[&<>"']/g, '') : '';
                                return `<li><b class="rl-pos">${index + 1}着</b><span class="lg-car car-${item.number}">${item.number}</span><span class="rl-name">${safe}</span><span class="rl-margin">${item.margin ?? ''}</span></li>`;
                            }
                        )
                        .join('')
                    : '';
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
            container.innerHTML = '<p class="empty-result">レースを再生すると表示します</p>';
            return;
        }
        const latest = logs.slice(-18).reverse();
        container.innerHTML = latest.map(item => {
            const rider = item.riderNumber == null ? '全体' : `${item.riderNumber}番`;
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
        // コースの下に「並び」: ラインごとに車番と名前 (周回の前から)。誰と誰がラインかを映像と合わせて見られるように
        const container = document.getElementById('line-list-ui');
        if (!container) return;
        const names = setup?.meta?.names ?? {};
        const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const short = n => { const x = String(names[n] ?? '').replace(/\s/g, ''); return x ? esc(x.length <= 3 ? x : x.slice(0, 2)) : ''; };
        const lineOf = n => (setup?.lines ?? []).find(line => line.members.includes(n));
        const groups = setup?.formation?.length
            ? setup.formation
            : [...(setup?.lines ?? []).map(line => line.members),
               ...Object.entries(setup?.riders ?? {}).filter(([, r]) => r?.solo).map(([n]) => [Number(n)])];
        const girls = groups.every(g => g.length === 1);
        container.innerHTML = `<span class="lg-label">${girls ? '周回の並び' : '並び'}</span>` + groups.map(group => {
            const isLine = group.length > 1 && lineOf(group[0]);
            return `<span class="lg-group${isLine ? '' : ' is-solo'}" title="${isLine ? 'ライン' : '単騎'}">${group.map(n => `<span class="lg-rider"><span class="lg-car car-${n}">${n}</span><small>${short(n)}</small></span>`).join('')}</span>`;
        }).join('');
    }

}