// KEIRIN FLOW — 自律AIの回帰テスト (npm test)
//
// これは「台本どおりの着順になるか」を確かめるテストではありません。
// 「AIが本当に自分で判断しているか」を確かめるテストです。
//   1. 同じ条件なら毎回同じレースになる (決定論)
//   2. 再生速度 0.5x〜3x で結果が変わらない
//   3. 全員が完走し、逆走・重なりがない
//   4. 能力を変えると結果が変わる (能力が判断に効いている)
//   5. 車番を付け替えても、同じ選手は同じ走りをする (車番ハードコードなし)
//   6. ラインIDの名前を変えても結果が変わらない (ラインIDハードコードなし)
//   7. Decision Log の判断にはすべて理由が付いている
//   8. race-ai.js に車番の決め打ちが書かれていない
//  10. ラインを組み替えても破綻しない (全員完走・仕掛けた選手が遅い選手の真後ろで詰まり続けない)
//   9. 競輪らしい攻防が起きる: 踏み合い(並走して競る) / 逃げのタレ / 番手ブロックが結果に効く

import { readFileSync } from 'node:fs';
import { PhysicsEngine } from './engine.js';
import { DEFAULT_RACE_SETUP } from './race-plan.js';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const clone = () => structuredClone(DEFAULT_RACE_SETUP);

function race(setup, { scale = 1, frame = 1 / 60 } = {}) {
  const e = new PhysicsEngine(setup);
  e.setSpeedScale(scale);
  e.start();
  let reverse = false, minCorridorGap = Infinity, t = 0;
  const last = new Map(e.riders.map(r => [r.number, r.distance]));
  e.__speeds = Object.fromEntries(e.riders.map(r => [r.number, { peak: 0, last: 0 }]));
  while (!e.riders.every(r => r.finished) && t < 200) {
    e.update(frame); t += frame;
    for (const r of e.riders) {
      if (!r.finished) { const sp = e.__speeds[r.number]; sp.peak = Math.max(sp.peak, r.speed); sp.last = r.speed; }
      if (r.distance < last.get(r.number) - 1e-9) reverse = true;
      last.set(r.number, r.distance);
      if (r.finished) continue;
      for (const o of e.riders) {
        if (o === r || o.finished || o.distance <= r.distance) continue;
        if (Math.abs(o.laneOffset - r.laneOffset) < 11) minCorridorGap = Math.min(minCorridorGap, o.distance - r.distance);
      }
    }
  }
  return {
    order: e.ranking.map(x => x.number),
    times: Object.fromEntries(e.ranking.map(x => [x.number, x.time])),
    finished: e.ranking.length,
    reverse, minCorridorGap,
    logs: e.decisionLogs.map(d => ({ n: d.riderNumber, a: d.action, m: d.message, c: d.category })),
    speeds: e.__speeds
  };
}

const str = o => o.join('-');

// 1. determinism
const a = race(clone()), b = race(clone());
check(str(a.order) === str(b.order) && a.logs.length === b.logs.length, '同じ条件なら同じレースになる', str(a.order));

// 2. playback speed independence
const bySpeed = [0.5, 1, 2, 3].map(scale => str(race(clone(), { scale }).order));
check(new Set(bySpeed).size === 1, '再生速度 0.5x/1x/2x/3x で着順が同じ', bySpeed.join(' | '));

// 3. physical sanity
check(a.finished === 9, '9人全員が完走する', `${a.finished}/9`);
check(!a.reverse, '逆走しない');
check(a.minCorridorGap >= 9 - 1e-6, '同じ走路で前後に重ならない (前に割り込むときも9m以上空ける)', a.minCorridorGap.toFixed(2));

// 4. abilities change the outcome
const variants = {
  '7-8-9を最強に': s => { for (const n of [7, 8, 9]) Object.assign(s.riders[n], { power: 1, acceleration: 1, endurance: 1, tacticalIQ: 1, aggression: .9 }); },
  '1番を弱い先行に': s => Object.assign(s.riders[1], { power: .6, acceleration: .6, endurance: .6 }),
  '4番を超強力な捲りに': s => Object.assign(s.riders[4], { power: 1, acceleration: 1, endurance: .95 }),
  '3番を単騎に': s => { s.lines[0] = { id: 'LINE_A', members: [1, 2], leader: 1 }; }
};
const results = {};
for (const [label, mutate] of Object.entries(variants)) {
  const s = clone(); mutate(s);
  results[label] = race(s);
  check(results[label].finished === 9 && str(results[label].order) !== str(a.order), `能力・構成を変えると結果が変わる: ${label}`, str(results[label].order));
}
check([7, 8, 9].includes(results['7-8-9を最強に'].order[0]), '最強にした7-8-9ラインから1着が出る', `1着 ${results['7-8-9を最強に'].order[0]}番`);
check(results['4番を超強力な捲りに'].order[0] === 4, '超強力にした捲り選手が捲り切る', `1着 ${results['4番を超強力な捲りに'].order[0]}番`);
check(results['1番を弱い先行に'].order.indexOf(1) > a.order.indexOf(1), '弱くした先行選手は着順を落とす', `${a.order.indexOf(1) + 1}着 → ${results['1番を弱い先行に'].order.indexOf(1) + 1}着`);

// 5. car numbers are labels only: relabel everybody and the same riders must ride the same race
const perm = { 1: 5, 2: 9, 3: 1, 4: 7, 5: 2, 6: 8, 7: 3, 8: 6, 9: 4 };
const relabeled = clone();
relabeled.lines = relabeled.lines.map(l => ({ id: l.id, members: l.members.map(n => perm[n]), leader: perm[l.leader] }));
relabeled.riders = Object.fromEntries(Object.entries(DEFAULT_RACE_SETUP.riders).map(([n, p]) => [perm[n], structuredClone(p)]));
const r = race(relabeled);
check(str(r.order) === str(a.order.map(n => perm[n])), '車番を付け替えても同じ選手は同じ着順', `${str(a.order.map(n => perm[n]))} vs ${str(r.order)}`);

// 6. line ids are labels only
const renamed = clone();
renamed.lines = renamed.lines.map((l, i) => ({ ...l, id: `X${i}` }));
check(str(race(renamed).order) === str(a.order), 'ラインIDの名前を変えても結果が同じ');

// 7. every logged decision explains itself
const unexplained = a.logs.filter(l => l.n != null && !(l.m && l.m.length >= 6));
check(unexplained.length === 0, 'Decision Log の判断にすべて理由が付いている', `${a.logs.length}件`);

// 8. no hard-coded car numbers in the decision code
const src = readFileSync(new URL('./race-ai.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
const hard = src.match(/number\s*===\s*\d|\[\s*\d\s*,\s*\d\s*,\s*\d\s*\]|rider\(\s*\d\s*\)/g);
check(!hard, 'race-ai.js に車番の決め打ちがない', hard ? hard.join(', ') : '');

// 9. keirin-like battles
const contestSecs = a.logs.filter(l => l.c === 'CONTEST' && /秒の踏み合い/.test(l.m)).map(l => Number(l.m.match(/([\d.]+)秒/)[1]));
check(contestSecs.length > 0 && Math.max(...contestSecs) >= 1.0, '突っ張り・捲りで並走の踏み合いが起き、1秒以上競る', contestSecs.map(x => `${x}秒`).join(', '));

const early = clone(); Object.assign(early.riders[1], { endurance: .55, aggression: .95 });
const er = race(early);
const fade1 = er.speeds[1];
check(er.logs.some(l => l.c === 'FATIGUE' && l.n === 1) && fade1.peak - fade1.last >= 3, '持久力の低い逃げ選手は最後にタレる', `最高${fade1.peak.toFixed(1)} → ゴール前${fade1.last.toFixed(1)}m/s`);

const withBlock = clone();
const noBlock = structuredClone(withBlock); for (const n of [2, 5, 8]) noBlock.riders[n].blockSkill = 0;
const wb = race(withBlock), nb = race(noBlock);
check(wb.logs.some(l => l.a === 'BLOCK') && str(wb.order) !== str(nb.order), '番手のブロックが着順に影響する', `ブロック有 ${str(wb.order)} / 無 ${str(nb.order)}`);

// 10. line changes must not break the race
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const layouts = ['123/456/789', '789/123/456', '456/123/789', '12/456/789/3', '1234/56789', '12/34/56/789', '147/258/369', '15/2/3/4/6/7/8/9', '12345/6789', '123/456/7/8/9', '7/123/8/456/9', '12/34/5/6/7/89', '1/2/3/4/5/6/7/8/9'];
  const bad = [];
  for (const layout of layouts) {
    const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(layout);
    const e = new PhysicsEngine(toRaceSetup(d)); e.start();
    const stuck = {}; let worst = 0, t = 0, split = 0, worstSplit = 0;
    while (!e.riders.every(r => r.finished) && t < 150) {
      e.update(1 / 60); t += 1 / 60;
      for (const r of e.riders) {
        if (r.finished || r.action !== 'ATTACK') { stuck[r.number] = 0; continue; }
        const blocker = e.riders.find(o => !o.finished && o !== r && o.distance - r.distance > 0 && o.distance - r.distance < 20 && Math.abs(o.laneOffset - r.laneOffset) < 11 && o.speed < r.speed - 2);
        stuck[r.number] = blocker ? (stuck[r.number] ?? 0) + 1 / 60 : 0;
        worst = Math.max(worst, stuck[r.number]);
      }
      // 他のラインの選手が、ラインの間に割り込んだまま走り続けていないか
      const splitNow = e.raceClock.remainingDistance < 600 && e.riders.some(b => {
        if (b.finished || !b.frontLineMate || b.action !== 'FOLLOW') return false;
        const f = e.rider(b.frontLineMate);
        return !f.finished && e.riders.some(o => !o.finished && o.lineId !== b.lineId && o.distance < f.distance && o.distance > b.distance && Math.abs(o.laneOffset - b.laneOffset) < 11 && Math.abs(f.laneOffset - b.laneOffset) < 11);
      });
      split = splitNow ? split + 1 / 60 : 0; worstSplit = Math.max(worstSplit, split);
    }
    if (e.ranking.length !== e.riders.length || worst > 2 || worstSplit > 3) bad.push(`${layout}: 完走${e.ranking.length}/${e.riders.length} 詰まり${worst.toFixed(1)}秒 割り込み${worstSplit.toFixed(1)}秒`);
  }
  check(bad.length === 0, 'ラインを組み替えても破綻しない (13通りの並び・単騎3人以上や全員単騎も含む: 全員完走・詰まらない・ラインの間に割り込まれ続けない)', bad.join(' / '));

  // 前受けが「出させる」を選んだら、誘導切りのラインが本当に前に出て、ラインのまま並ぶ
  const yieldCase = clone(); Object.assign(yieldCase.riders[1], { power: .6, acceleration: .6, endurance: .6 });
  const ye = new PhysicsEngine(yieldCase); ye.start();
  while (ye.raceClock.remainingDistance > 480) ye.update(1 / 60);
  const order = [...ye.riders].sort((a, b) => b.distance - a.distance).map(r => r.number).join('');
  check(order.startsWith('789'), '前受けが出させたら、誘導切りのラインがラインのまま前に入る', `残480mの隊列 ${order}`);
}

// 11. 展開の指定 (タップで選ぶ) がそのとおりに効く
{
  const { toRaceSetup, SAMPLE_RACE_DATA } = await import('./race-data.js');
  const run = mut => { const d = structuredClone(SAMPLE_RACE_DATA); mut(d); const e = new PhysicsEngine(toRaceSetup(d)); e.start(); for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60); return e; };
  const oi = run(d => { d.tactics = { 7: 'OIKOMI' }; });
  const earlyAttack = oi.decisionLogs.some(l => l.riderNumber === 7 && ['ATTACK', 'MOVE_UP'].includes(l.action) && l.remaining > 110);
  check(!earlyAttack, '「追込」を指定した先頭は、最後の直線まで仕掛けない (誘導切りにも来ない)');
  const ka = run(d => { d.tactics = { 4: 'KAMASHI' }; });
  const kamashi = ka.decisionLogs.find(l => l.riderNumber === 4 && /カマす/.test(l.message));
  check(!!kamashi && kamashi.remaining > 420, '「カマシ」を指定すると、打鐘前後に後方から一気に仕掛ける', kamashi ? `残${kamashi.remaining.toFixed(0)}m` : 'なし');
  const ys = run(d => { d.frontResponse = { 1: 'YIELD' }; });
  check(ys.decisionLogs.some(l => l.riderNumber === 1 && /出させて/.test(l.message)), '前受けに「出させる」を指定すると、誘導切りを出させる');
  const ts = run(d => { d.frontResponse = { 1: 'TSUPPARI' }; d.riders[0].score = 102; });
  check(ts.decisionLogs.some(l => l.riderNumber === 1 && /突っ張る/.test(l.message)), '前受けに「突っ張る」を指定すると、地力が下でも突っ張る');
}

// 12. 競輪のいろいろな動きが、いろいろな並び・能力の中で実際に起きる
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const pats = { 誘導切り: /誘導切り成功/, 突っ張り: /突っ張る/, 出させる: /出させ|受け入れる/, 先行: /主導権を握って先行/, 叩き: /叩いて主導権/, カマシ: /カマす/, 捲り: /捲りに出る/, 番手ブロック: /牽制/, 番手捲り: /番手捲り/, 切り替え: /切り替える/, 踏み合い: /並んで踏み合い/, タレ: /タレ始める/, 内すくい: /内を突く/, 包まれ: /塞がれ/ };
  const seen = Object.fromEntries(Object.keys(pats).map(k => [k, 0]));
  const layouts = ['123/456/789', '789/123/456', '456/123/789', '12/456/789/3', '1234/56789', '12/34/56/789', '123/456/7/8/9', '7/123/8/456/9'];
  const mods = [d => {}, d => { d.riders[0].score = 104; }, d => { d.riders[3].score = 120; }, d => { d.riders[6].score = 119; }];
  for (const L of layouts) for (const mod of mods) {
    const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(L); mod(d);
    const e = new PhysicsEngine(toRaceSetup(d)); e.start();
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    const msgs = e.decisionLogs.map(x => x.message).join('\n');
    for (const [k, re] of Object.entries(pats)) if (re.test(msgs)) seen[k] += 1;
  }
  const missing = Object.entries(seen).filter(([, v]) => v === 0).map(([k]) => k);
  check(!missing.length, '32レースの中で、競輪の14種類の動きがすべて起きる', Object.entries(seen).map(([k, v]) => `${k}${v}`).join(' '));
}

console.log(failures ? `\n${failures}件 失敗` : '\nすべて合格');
process.exit(failures ? 1 : 0);
