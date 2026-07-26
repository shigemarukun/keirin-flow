import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname);
const read = name => readFile(resolve(root, name), 'utf8');
const importSource = async name => {
    const source = await read(name);
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(url);
};

const results = [];
const check = async (name, fn) => {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`PASS  ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error: error.message });
        console.error(`FAIL  ${name}: ${error.message}`);
    }
};

const { PhysicsEngine, RACE_PROFILES } = await importSource('engine.js');
const { AIModel } = await importSource('ai.js');
const { getTrackPoint } = await importSource('ui.js');
const groups = new AIModel().getInitialLineGroups();

await check('9車が重複なく生成される', () => {
    const flat = groups.flat();
    assert.equal(flat.length, 9);
    assert.equal(new Set(flat).size, 9);
    assert.deepEqual([...flat].sort((a, b) => a - b), [1,2,3,4,5,6,7,8,9]);
});

await check('HTML・main.js・モジュール構成が一致する', async () => {
    const html = await read('index.html');
    const main = await read('main.js');
    for (const id of ['btn-start','btn-pause','btn-reset','speedRange','speedVal','bankCanvas']) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    for (const file of ['ai.js','engine.js','ui.js']) {
        assert.match(main, new RegExp(`from ["']\\./${file.replace('.', '\\.')}["']`));
        await read(file);
    }
    assert.match(main, /physics\.onBell/);
});

await check('400mプロファイルが正しく読み込まれる', () => {
    const profile = RACE_PROFILES.PROFILE_400;
    assert.equal(profile.TRACK_LENGTH, 400);
    assert.equal(profile.RACE_DISTANCE, 800);
    assert.equal(profile.FORMATION_SPEED, 10.5);
    assert.ok(profile.PacerLeaveLine > profile.Bell);
    assert.ok(profile.Bell > profile.PacerExit);
    assert.ok(profile.PacerExit > profile.FinalLap);
});

await check('初期状態は既に一定速度・一列隊列である', () => {
    const engine = new PhysicsEngine(groups);
    const state = engine.getState();
    assert.equal(state.currentState, 'POSITION_BATTLE');
    assert.equal(state.raceClock.owner, 'PACER');
    assert.equal(state.raceClock.remainingDistance, 800);
    for (const rider of state.riders) {
        assert.equal(rider.speed, 10.5);
        assert.equal(rider.laneOffset, -18);
    }
    const ordered = [...state.riders].sort((a,b) => a.globalIndex - b.globalIndex);
    for (let i = 1; i < ordered.length; i += 1) {
        assert.ok(Math.abs((ordered[i-1].distance - ordered[i].distance) - 17) < 1e-9);
    }
});

await check('描画軌道は左回り（6時→3時→12時→9時）', () => {
    const geometry = { cx: 400, cy: 400, halfStraight: 140, radius: 200 };
    const p0 = getTrackPoint(geometry, 0, 0);
    const p50 = getTrackPoint(geometry, 50, 0);
    const p150 = getTrackPoint(geometry, 150, 0);
    const p250 = getTrackPoint(geometry, 250, 0);
    assert.equal(p0.x, 400);
    assert.equal(p0.y, 600);
    assert.ok(p50.x > p0.x, '6時位置から右方向（3時側）へ進むこと');
    assert.ok(p150.y < p50.y, 'その後12時側へ進むこと');
    assert.ok(p250.x < p150.x, 'その後9時側へ進むこと');
});

const simulate = scale => {
    const engine = new PhysicsEngine(groups);
    engine.setSpeedScale(scale);
    let bellCount = 0;
    let finishCount = 0;
    engine.onBell(() => { bellCount += 1; });
    engine.onFinish(() => { finishCount += 1; });
    engine.start();

    let frames = 0;
    let previousRemaining = engine.raceClock.remainingDistance;
    let remainingMonotonic = true;
    let formationOrderStable = true;
    let maxFormationGapError = 0;
    const maxFrames = 50000;

    while (engine.isStarted && frames < maxFrames) {
        engine.update(1 / 60);
        const state = engine.getState();
        const remaining = state.raceClock.remainingDistance;
        if (remaining > previousRemaining + 1e-8) remainingMonotonic = false;
        previousRemaining = remaining;

        if (state.currentState === 'POSITION_BATTLE') {
            const ordered = [...state.riders].sort((a,b) => a.globalIndex - b.globalIndex);
            for (let i = 1; i < ordered.length; i += 1) {
                const gap = ordered[i-1].distance - ordered[i].distance;
                maxFormationGapError = Math.max(maxFormationGapError, Math.abs(gap - 17));
                if (gap <= 0) formationOrderStable = false;
            }
            if (ordered.some(r => Math.abs(r.laneOffset + 18) > 1e-8)) formationOrderStable = false;
        }
        frames += 1;
    }

    return {
        engine,
        state: engine.getState(),
        frames,
        bellCount,
        finishCount,
        remainingMonotonic,
        formationOrderStable,
        maxFormationGapError
    };
};

for (const scale of [0.5, 1, 2, 3]) {
    await check(`${scale}xでイベント・完走・隊列維持`, () => {
        const result = simulate(scale);
        assert.ok(result.frames < 50000, 'simulation timed out');
        assert.equal(result.bellCount, 1);
        assert.equal(result.finishCount, 1);
        assert.equal(result.state.ranking.length, 9);
        assert.ok(result.state.riders.every(r => r.finished));
        assert.equal(result.remainingMonotonic, true);
        assert.equal(result.formationOrderStable, true);
        assert.ok(result.maxFormationGapError <= 1.0, `formation gap error ${result.maxFormationGapError}`);
        assert.deepEqual(result.state.raceClock.firedEventSequence,
            ['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
        assert.equal(result.state.raceClock.owner, 'LEADER');
    });
}

await check('RESETで完全に初期状態へ戻る', () => {
    const engine = new PhysicsEngine(groups);
    engine.start();
    for (let i = 0; i < 100; i += 1) engine.update(1 / 60);
    engine.reset();
    const state = engine.getState();
    assert.equal(state.isStarted, false);
    assert.equal(state.elapsedTime, 0);
    assert.equal(state.bellRung, false);
    assert.equal(state.currentState, 'POSITION_BATTLE');
    assert.equal(state.raceClock.owner, 'PACER');
    assert.equal(state.raceClock.remainingDistance, 800);
    assert.deepEqual(state.raceClock.firedEventSequence, []);
    assert.ok(state.riders.every(r => r.speed === 10.5 && r.laneOffset === -18 && !r.finished));
});

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
