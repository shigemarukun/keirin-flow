const TRACK_LENGTH = 400;
const SEGMENT_LENGTH = 100;

const wrapTrackDistance = distance => ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;

export function getTrackPoint({ cx, cy, halfStraight, radius }, absoluteDistance, laneOffset = 0) {
    const d = wrapTrackDistance(absoluteDistance);
    const r = radius + laneOffset;

    if (d < 100) {
        const p = d / SEGMENT_LENGTH;
        return {
            x: cx - halfStraight + (2 * halfStraight * p),
            y: cy + r,
            angle: 0
        };
    }

    if (d < 200) {
        const p = (d - 100) / SEGMENT_LENGTH;
        const theta = Math.PI / 2 - (Math.PI * p);
        return {
            x: cx + halfStraight + (Math.cos(theta) * r),
            y: cy + (Math.sin(theta) * r),
            angle: theta - Math.PI / 2
        };
    }

    if (d < 300) {
        const p = (d - 200) / SEGMENT_LENGTH;
        return {
            x: cx + halfStraight - (2 * halfStraight * p),
            y: cy - r,
            angle: Math.PI
        };
    }

    const p = (d - 300) / SEGMENT_LENGTH;
    const theta = -Math.PI / 2 - (Math.PI * p);
    return {
        x: cx - halfStraight + (Math.cos(theta) * r),
        y: cy + (Math.sin(theta) * r),
        angle: theta - Math.PI / 2
    };
}

export class UIRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) throw new Error(`Canvas #${canvasId} not found`);
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) throw new Error('2D canvas context is unavailable');

        this.cx = this.canvas.width / 2;
        this.cy = this.canvas.height / 2;
        this.halfStraight = 140;
        this.radius = 200;
        this.trackGeometry = {
            cx: this.cx,
            cy: this.cy,
            halfStraight: this.halfStraight,
            radius: this.radius
        };
    }

    getBankCoordinates(distance, laneOffset = 0) {
        return getTrackPoint(this.trackGeometry, distance, laneOffset);
    }

    drawTrack(offset, width, color) {
        const c = this.ctx;
        c.beginPath();
        for (let distance = 0; distance <= TRACK_LENGTH; distance += 1) {
            const point = this.getBankCoordinates(distance, offset);
            if (distance === 0) c.moveTo(point.x, point.y);
            else c.lineTo(point.x, point.y);
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
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawTrack(0, 100, '#334155');
        this.drawTrack(-50, 2, '#64748b');
        this.drawTrack(50, 2, '#64748b');

        const inside = this.getBankCoordinates(0, -50);
        const outside = this.getBankCoordinates(0, 50);
        c.beginPath();
        c.moveTo(inside.x, inside.y);
        c.lineTo(outside.x, outside.y);
        c.lineWidth = 4;
        c.strokeStyle = '#f8fafc';
        c.stroke();
    }

    drawMarker(x, y, radius, background, border, label, textColor, fontSize = 11) {
        const c = this.ctx;
        c.beginPath();
        c.arc(x, y, radius, 0, Math.PI * 2);
        c.fillStyle = background;
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = border;
        c.stroke();
        c.fillStyle = textColor;
        c.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, x, y);
    }

    drawRiders(state) {
        if (state.pacer.state !== 'EXITED') {
            const point = this.getBankCoordinates(state.pacer.distance, state.pacer.laneOffset);
            this.drawMarker(point.x, point.y, 10, '#64748b', '#f8fafc', '誘', '#ffffff', 10);
        }

        const orderedRiders = [...state.riders].sort((a, b) => a.globalIndex - b.globalIndex);
        for (const rider of orderedRiders) {
            const point = this.getBankCoordinates(rider.distance, rider.laneOffset);
            this.drawMarker(
                point.x,
                point.y,
                12,
                rider.style.background,
                '#ffffff',
                String(rider.number),
                rider.style.text,
                12
            );
        }
    }

    updateUI(state) {
        const lapCounter = document.getElementById('lap-counter');
        const raceStatus = document.getElementById('race-status');
        const gapStatus = document.getElementById('gap-status');
        const resultList = document.getElementById('result-list');

        const leaderDistance = Math.max(...state.riders.map(rider => rider.distance));
        const lap = leaderDistance < 400 ? '1周目' : '2周目（最終周）';
        const remaining = Math.max(0, Math.ceil(state.totalDistance - leaderDistance));
        if (lapCounter) lapCounter.textContent = `${lap} / 残り${remaining}m`;

        if (raceStatus) {
            if (state.ranking.length === state.riders.length) {
                raceStatus.textContent = 'FINISHED';
                raceStatus.style.color = '#f59e0b';
            } else if (state.isStarted) {
                raceStatus.textContent = state.bellRung ? 'BELL / FINAL LAP' : 'RACING...';
                raceStatus.style.color = state.bellRung ? '#f59e0b' : '#22c55e';
            } else {
                raceStatus.textContent = state.elapsedTime > 0 ? 'PAUSED' : 'PRE-RACE';
                raceStatus.style.color = '#38bdf8';
            }
        }

        if (gapStatus) {
            const minGap = state.diagnostics.minGap;
            const maxGap = state.diagnostics.maxGap;
            gapStatus.textContent = minGap == null
                ? '車間: --'
                : `車間: ${minGap.toFixed(1)}〜${maxGap.toFixed(1)}m`;
        }

        if (resultList) {
            resultList.innerHTML = state.ranking.length
                ? state.ranking.map(item => `<li><strong>${item.rank}着 ${item.number}番</strong><span>${item.margin}</span></li>`).join('')
                : '<li class="empty-result">レース終了後に表示</li>';
        }
    }

    renderLineList(lineGroups) {
        const container = document.getElementById('line-list-ui');
        if (!container) return;

        container.innerHTML = lineGroups.map((group, index) => `
            <div class="line-row">
                <span class="line-name">ライン${index + 1}</span>
                <span class="line-members">${group.join(' - ')}</span>
            </div>
        `).join('');
    }
}
