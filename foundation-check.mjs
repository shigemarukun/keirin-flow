import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

const { PhysicsEngine } = await importSource('engine.js');
const { AIModel } = await importSource('ai.js');
const { getTrackPoint } = await importSource('ui.js');
const groups = new AIModel().getInitialLineGroups();

await check('9車が重複なく生成される', () => {
  const flat = groups.flat();
  assert.equal(flat.length, 9);
  assert.equal(new Set(flat).size, 9);
  assert.deepEqual([...flat].sort((a, b) => a - b), [1,2,3,4,5,6,7,8,9]);
});

await check('HTMLとmain.jsの必須IDが一致する', async () => {
  const html = await read('index.html');
  const main = await read('main.js');
  for (const id of ['btn-start','btn-pause','btn-reset','speedRange','speedVal']) {
    assert.ok(html.includes(`id="${id}"`) || html.includes(`id='${id}'`), `HTML missing ${id}`);
    assert.ok(main.includes(`getElementById('${id}')`) || main.includes(`getElementById("${id}")`), `main.js missing ${id}`);
  }
  assert.ok(html.includes('id="bankCanvas"') || html.includes("id='bankCanvas'"));
  assert.ok(main.includes("new UIRenderer('bankCanvas')") || main.includes('new UIRenderer("bankCanvas")'));
});

await check('main.jsのimport先が存在する', async () => {
  const main = await read('main.js');
  for (const file of ['ai.js','engine.js','ui.js']) {
    assert.match(main, new RegExp(`from ["']\\./${file.replace('.', '\\.')}["']`));
    await read(file);
  }
});

await check('バンク座標が0mと400mで一致する', () => {
  const geometry = { cx: 400, cy: 400, halfStraight: 140, radius: 200 };
  const a = getTrackPoint(geometry, 0, 0);
  const b = getTrackPoint(geometry, 400, 0);
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
  assert.ok(Math.abs(a.y - b.y) < 1e-9);
  assert.equal(a.x, 400);
  assert.equal(a.y, 600);
});

await check('ゴールラインがホームストレッチ中央にある', () => {
  const geometry = { cx: 400, cy: 400, halfStraight: 140, radius: 200 };
  const inside = getTrackPoint(geometry, 0, -50);
  const outside = getTrackPoint(geometry, 0, 50);
  assert.equal(inside.x, 400);
  assert.equal(outside.x, 400);
  assert.equal((inside.y + outside.y) / 2, 600);
});

const simulate = scale => {
  const engine = new PhysicsEngine(groups);
  let bellCount = 0;
  let finishCount = 0;
  engine.onBell(() => { bellCount += 1; });
  engine.onFinish(() => { finishCount += 1; });
  engine.setSpeedScale(scale);
  engine.start();

  let frames = 0;
  let minGap = Infinity;
  let maxGap = -Infinity;
  let maxAcceleration = 0;
  const maxFrames = 30000;

  while (engine.isStarted && frames < maxFrames) {
    engine.update(1 / 60);
    const state = engine.getState();
    for (const item of state.diagnostics.gaps) {
      minGap = Math.min(minGap, item.gap);
      maxGap = Math.max(maxGap, item.gap);
    }
    for (const rider of state.riders) {
      maxAcceleration = Math.max(maxAcceleration, Math.abs(rider.acceleration));
    }
    frames += 1;
  }

  return { state: engine.getState(), frames, bellCount, finishCount, minGap, maxGap, maxAcceleration };
};

for (const scale of [0.5, 1, 2, 3]) {
  await check(`${scale}xでベル1回・9車完走・順位確定`, () => {
    const run = simulate(scale);
    assert.equal(run.bellCount, 1);
    assert.equal(run.finishCount, 1);
    assert.equal(run.state.riders.filter(r => r.finished).length, 9);
    assert.equal(run.state.ranking.length, 9);
    assert.equal(new Set(run.state.ranking.map(r => r.number)).size, 9);
    assert.ok(run.frames < 30000);
  });

  await check(`${scale}xでライン車間が破綻しない`, () => {
    const run = simulate(scale);
    assert.ok(run.minGap >= 16.9, `minGap=${run.minGap}`);
    assert.ok(run.maxGap <= 20.5, `maxGap=${run.maxGap}`);
    assert.ok(run.maxAcceleration <= 4.21, `maxAcceleration=${run.maxAcceleration}`);
  });
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) process.exitCode = 1;
