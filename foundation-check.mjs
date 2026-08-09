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

const orderByDistance = state =>
    [...state.riders]
        .sort((a, b) => b.distance - a.distance)
        .map(rider => rider.number);

await check('3-3-3固定ラインが正しく生成される', () => {
    assert.deepEqual(groups, [[1,2,3],[4,5,6],[7,8,9]]);
    const flat = groups.flat();
    assert.equal(flat.length, 9);
    assert.equal(new Set(flat).size, 9);
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

await check('400mプロファイルとイベント順が維持される', () => {
    const profile = RACE_PROFILES.PROFILE_400;
    assert.equal(profile.TRACK_LENGTH, 400);
    assert.equal(profile.RACE_DISTANCE, 800);
    assert.equal(profile.FORMATION_SPEED, 10.5);
    assert.ok(profile.PacerLeaveLine > profile.Bell);
    assert.ok(profile.Bell > profile.PacerExit);
    assert.ok(profile.PacerExit > profile.FinalLap);
});

await check('初期隊列は 誘導→1-2-3→4-5-6→7-8-9 の一列', () => {
    const engine = new PhysicsEngine(groups);
    const state = engine.getState();
    assert.deepEqual(orderByDistance(state), [1,2,3,4,5,6,7,8,9]);
    assert.equal(state.pacer.state, 'LEADING');
    assert.ok(state.riders.every(r => r.speed === 10.5 && r.laneOffset === -18));
});

await check('描画軌道は左回りを維持する', () => {
    const geometry = { cx: 400, cy: 400, halfStraight: 140, radius: 200 };
    const p0 = getTrackPoint(geometry, 0, 0);
    const p20 = getTrackPoint(geometry, 20, 0);
    assert.ok(p20.x > p0.x, 'ホーム中央から右方向へ進むこと');
});

const simulate = scale => {
    const engine = new PhysicsEngine(groups);
    engine.setSpeedScale(scale);
    let bellCount = 0;
    let finishCount = 0;
    let previousRemaining = engine.raceClock.remainingDistance;
    let remainingMonotonic = true;
    let pacerExitOrder = null;
    let preFinalAttackOrder = null;
    let previousPacerState = engine.pacer.state;

    engine.onBell(() => { bellCount += 1; });
    engine.onFinish(() => { finishCount += 1; });
    engine.start();

    let frames = 0;
    while (engine.isStarted && frames < 100000) {
        engine.update(1 / 60);
        const state = engine.getState();
        const remaining = state.raceClock.remainingDistance;

        if (remaining > previousRemaining + 1e-8) remainingMonotonic = false;
        previousRemaining = remaining;

        if (previousPacerState !== 'EXITED' && state.pacer.state === 'EXITED') {
            pacerExitOrder = orderByDistance(state);
        }
        previousPacerState = state.pacer.state;

        if (!preFinalAttackOrder && remaining <= 120) {
            preFinalAttackOrder = orderByDistance(state);
        }

        frames += 1;
    }

    return {
        state: engine.getState(),
        frames,
        bellCount,
        finishCount,
        remainingMonotonic,
        pacerExitOrder,
        preFinalAttackOrder
    };
};

for (const scale of [0.5, 1, 2, 3]) {
    await check(`${scale}x 固定シナリオが最後まで成立する`, () => {
        const result = simulate(scale);
        assert.ok(result.frames < 100000, 'simulation timed out');
        assert.equal(result.bellCount, 1);
        assert.equal(result.finishCount, 1);
        assert.equal(result.remainingMonotonic, true);
        assert.deepEqual(result.pacerExitOrder, [7,8,9,4,5,6,1,2,3], '誘導退避完了時のライン順');
        assert.deepEqual(result.preFinalAttackOrder, [1,2,3,7,8,9,4,5,6], '4-5-6最終捲り開始直前のライン順');
        assert.deepEqual(result.state.ranking.map(item => item.number), [4,5,6,1,2,3,7,8,9], 'ゴール順');
        assert.deepEqual(result.state.raceClock.firedEventSequence,
            ['PacerLeaveLine','Bell','PacerExit','FinalLap','FinalBack','Finish']);
        assert.equal(result.state.raceClock.owner, 'LEADER');
    });
}

await check('RESETで3-3-3初期状態へ戻る', () => {
    const engine = new PhysicsEngine(groups);
    engine.start();
    for (let i = 0; i < 500; i += 1) engine.update(1 / 60);
    engine.reset();
    const state = engine.getState();
    assert.equal(state.isStarted, false);
    assert.equal(state.elapsedTime, 0);
    assert.equal(state.bellRung, false);
    assert.equal(state.pacer.state, 'LEADING');
    assert.equal(state.raceClock.remainingDistance, 800);
    assert.deepEqual(orderByDistance(state), [1,2,3,4,5,6,7,8,9]);
});

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
