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
check(a.minCorridorGap >= 5 - 1e-6, '同じ走路で前後に重ならない (前に割り込むときも5m以上空ける)', a.minCorridorGap.toFixed(2));

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
check([4, 5].includes(results['4番を超強力な捲りに'].order[0]) && results['4番を超強力な捲りに'].order.slice(0, 3).includes(4), '超強力にした捲り選手のラインが1着 (本人が捲り切るか、番手が差す)', `着順 ${str(results['4番を超強力な捲りに'].order)}`);
{
  // 1レースだけだと展開の巡り合わせで逆転することもあるので、並びを変えた6レースの平均着順で比べる
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const avg = power => { let sum = 0; const L = ['123/456/789', '123/789/456', '456/123/789', '789/123/456', '12/456/789/3', '1234/56789'];
    for (const l of L) { const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(l); d.tactics = { 1: 'SENKO' }; Object.assign(d.riders[0], { score: power, style: '逃' });
      const e = new PhysicsEngine(toRaceSetup(d)); e.start(); for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
      sum += e.ranking.findIndex(r => r.number === 1) + 1; }
    return sum / L.length; };
  const st = avg(120), w = avg(101);
  check(w > st, '同じ先行でも、弱い選手は強い選手より着順が悪い (6レースの平均)', `強い先行 平均${st.toFixed(1)}着 / 弱い先行 平均${w.toFixed(1)}着`);
}

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

// (外の選手に包まれて仕掛けられないこともあるので、各ラインの先頭で試し、前に出られた選手がタレるかを見る)
const fades = [];
for (const lead of [1, 4, 7]) {
  const early = clone(); Object.assign(early.riders[lead], { endurance: .55, aggression: .95, tactic: 'SENKO' });
  const er = race(early), sp = er.speeds[lead];
  const led = er.logs.some(l => l.n === lead && /主導権|先行/.test(l.m));
  if (led) fades.push({ lead, ok: er.logs.some(l => l.c === 'FATIGUE' && l.n === lead) && sp.peak - sp.last >= 3, txt: `${lead}番 最高${sp.peak.toFixed(1)}→${sp.last.toFixed(1)}m/s` });
}
check(fades.length > 0 && fades.every(f => f.ok), '持久力の低い逃げ選手は、前に出ても最後にタレる', fades.map(f => f.txt).join(' / '));

{
  // いくつかの並びで、番手のブロックを無くすと着順が変わるレースがあるか
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  let changed = 0, blockedRaces = 0;
  for (const L of ['123/456/789', '789/123/456', '456/123/789', '12/34/56/789', '147/258/369', '123/456/7/8/9']) {
    const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(L);
    const withBlock = toRaceSetup(d), noBlock = structuredClone(withBlock);
    for (const r of Object.values(noBlock.riders)) r.blockSkill = 0;
    const wb = race(withBlock), nb = race(noBlock);
    if (wb.logs.some(l => l.a === 'BLOCK')) blockedRaces++;
    if (str(wb.order) !== str(nb.order)) changed++;
  }
  check(blockedRaces > 0 && changed > 0, '番手のブロックが着順に影響する', `6レース中 ブロックあり${blockedRaces} / ブロックを無くすと着順が変わる${changed}`);
}

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
        if (b.finished || !b.frontLineMate || b.action !== 'FOLLOW' || b.followTargetNumber !== b.frontLineMate) return false; // 切り替えた選手は除く
        const f = e.rider(b.frontLineMate);
        return !f.finished && e.riders.some(o => !o.finished && o.lineId !== b.lineId && o.distance < f.distance && o.distance > b.distance && Math.abs(o.laneOffset - b.laneOffset) < 11 && Math.abs(f.laneOffset - b.laneOffset) < 11);
      });
      split = splitNow ? split + 1 / 60 : 0; worstSplit = Math.max(worstSplit, split);
    }
    if (e.ranking.length !== e.riders.length || worst > 4 || worstSplit > 4) bad.push(`${layout}: 完走${e.ranking.length}/${e.riders.length} 詰まり${worst.toFixed(1)}秒 割り込み${worstSplit.toFixed(1)}秒`);
  }
  check(bad.length === 0, 'ラインを組み替えても破綻しない (13通りの並び・単騎3人以上や全員単騎も含む: 全員完走・詰まらない・ラインの間に4秒以上割り込まれ続けない)', bad.join(' / '));

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

// 11b. 番手競り: 単騎が番手を競り、強ければ番手を奪い、負けた番手は3番手に回る
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const runSeri = score => { const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines('123/456/78/9'); Object.assign(d.riders[8], { score, style: '追' }); d.riders[1].score = 104; d.tactics = { 9: 'SERI:1' };
    const e = new PhysicsEngine(toRaceSetup(d)); e.start(); let order = null;
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) { e.update(1 / 60); if (!order && e.raceClock.remainingDistance < 500) order = [...e.riders].sort((a, b) => b.distance - a.distance).map(r => r.number).join(''); }
    return { e, order }; };
  const strong = runSeri(122), weak = runSeri(100);
  check(strong.e.decisionLogs.some(l => /番手を奪う/.test(l.message)) && strong.order.includes('192'), '強い単騎が番手を競ると、番手を奪い、元の番手は3番手に回る', `残500mの隊列 ${strong.order}`);
  check(weak.e.decisionLogs.some(l => /番手を守る/.test(l.message)) && weak.order.includes('12'), '弱い単騎が競っても、番手は守られる', `残500mの隊列 ${weak.order}`);
}

// 12. 競輪のいろいろな動きが、いろいろな並び・能力の中で実際に起きる
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const pats = { 誘導切り: /誘導切り成功/, 突っ張り: /突っ張る/, 出させる: /出させ|受け入れる/, 先行: /主導権を握って先行/, 叩き: /叩いて主導権/, カマシ: /カマす/, 捲り: /捲りに出る/, 番手ブロック: /牽制/, 番手捲り: /番手捲り/, 切り替え: /切り替える/, 踏み合い: /並んで踏み合い/, タレ: /タレ始める/, 内すくい: /内を突く/ };
  const seen = Object.fromEntries(Object.keys(pats).map(k => [k, 0]));
  const layouts = ['123/456/789', '789/123/456', '456/123/789', '12/456/789/3', '1234/56789', '12/34/56/789', '123/456/7/8/9', '7/123/8/456/9'];
  const mods = [d => {}, d => { d.riders[0].score = 104; }, d => { d.riders[3].score = 120; }, d => { d.riders[6].score = 119; }];
  // (画面の「何通りもの未来」と同じく、選手の調子を少しゆらした条件で走らせる)
  const { withCondition } = await import('./forecast.js');
  let seedN = 0;
  // (内すくい・番手捲りのようなまれな動きもあるので、調子を変えて2回ずつ = 64レース)
  for (const L of layouts) for (const mod of mods) for (let rep = 0; rep < 2; rep++) {
    const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(L); mod(d);
    const e = new PhysicsEngine(withCondition(toRaceSetup(d), 4000 + seedN++).setup); e.start();
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    const msgs = e.decisionLogs.map(x => x.message).join('\n');
    for (const [k, re] of Object.entries(pats)) if (re.test(msgs)) seen[k] += 1;
  }
  const missing = Object.entries(seen).filter(([, v]) => v === 0).map(([k]) => k);
  check(!missing.length, '64レースの中で、競輪の13種類の動きがすべて起きる', Object.entries(seen).map(([k, v]) => `${k}${v}`).join(' '));
}

// 13. 実際の競輪のデータに近い結果になる (いろいろな並び・得点で72レース)
//   実データ (男子7車・ライン位置別の1着率): 先頭 21.6% / 番手 14.9% / 3番手 2.6%
//   400バンクの1着の決まり手: 逃げ 25% / 捲り 30% / 差し 45%
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pos = { 先頭: [0, 0], 番手: [0, 0], 三番手: [0, 0] }; const how = { 逃げ: 0, 捲り: 0, 差し: 0 }; let n = 0, bs1 = 0;
  for (const L of ['123/456/789', '789/123/456', '456/123/789', '147/258/369', '369/147/258', '12/456/789/3', '123/456/7/8/9', '1234/56789', '12/34/56/789']) for (let i = 0; i < 8; i++) {
    const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(L);
    for (const r of d.riders) r.score = +(103 + rnd() * 16).toFixed(1);
    const e = new PhysicsEngine(toRaceSetup(d)); e.start();
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    n++; const w = e.ranking[0].number; how[e.getStory().kimarite.how] += 1;
    if (e.recorder.snapshots.back?.order?.[0] === w) bs1++;
    for (const r of e.riders) { const k = r.role === 'SOLO' ? null : ['先頭', '番手', '三番手'][r.linePosition]; if (!k) continue; pos[k][0]++; if (r.number === w) pos[k][1]++; }
  }
  const rate = ([c, x]) => x / c * 100;
  const sente = rate(pos.先頭), bante = rate(pos.番手), third = rate(pos.三番手);
  check(sente >= 12 && sente <= 30 && bante >= 8 && bante <= 25 && third <= 8,
    'ライン位置別の1着率が実データに近い (先頭12〜30% / 番手8〜25% / 3番手8%以下)', `先頭${sente.toFixed(1)}% 番手${bante.toFixed(1)}% 3番手${third.toFixed(1)}%`);
  const pct = k => how[k] / n * 100;
  check(pct('逃げ') >= 12 && pct('逃げ') <= 40 && pct('差し') >= 30 && pct('差し') <= 70 && pct('捲り') >= 10,
    '決まり手の割合が実データに近い (逃げ12〜40% / 差し30〜70% / 捲り10%以上)', `逃げ${pct('逃げ').toFixed(0)}% 捲り${pct('捲り').toFixed(0)}% 差し${pct('差し').toFixed(0)}%`);
  check(bs1 / n <= 0.4, '逃げは残りすぎない (バックで先頭の選手の1着率が4割以下。実際の逃げ1着は約25%)', `${Math.round(bs1 / n * 100)}%`);
}

// 14. 333バンク・500バンク: 全員完走し、333は逃げ、500は差しが多くなる (実データの傾向)
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const kim = bank => {
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const k = { 逃げ: 0, 捲り: 0, 差し: 0 }; let n = 0, ok = true;
    for (const L of ['123/456/789', '789/123/456', '456/123/789', '147/258/369', '369/147/258', '12/456/789/3', '123/456/7/8/9', '1234/56789', '12/34/56/789']) for (let i = 0; i < 8; i++) {
      const d = structuredClone(SAMPLE_RACE_DATA); d.lines = parseLines(L); d.bank = bank;
      for (const r of d.riders) r.score = +(103 + rnd() * 16).toFixed(1);
      const e = new PhysicsEngine(toRaceSetup(d)); e.start();
      for (let t = 0; t < 200 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
      if (e.ranking.length !== 9) ok = false;
      k[e.getStory().kimarite.how]++; n++;
    }
    return { ok, nige: k.逃げ / n, sashi: k.差し / n };
  };
  const a = kim(333), b = kim(500);
  check(a.ok && b.ok && a.nige > b.nige && b.sashi > a.sashi, '333バンクは逃げ、500バンクは差しが多くなる (全員完走)',
    `333: 逃げ${Math.round(a.nige * 100)}% 差し${Math.round(a.sashi * 100)}% / 500: 逃げ${Math.round(b.nige * 100)}% 差し${Math.round(b.sashi * 100)}%`);
}

// ---------- 決まり手の実績とガールズ (出走表 → レース) ----------
{
  const { toRaceSetup } = await import('./race-data.js');
  const run = setup => { const e = new PhysicsEngine(setup); e.start(); for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60); return { order: e.ranking.map(r => r.number), how: e.getStory().kimarite?.how }; };
  let rs = 5; const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  // 同じ選手に「逃げの実績」と「捲りの実績」を入れて、勝ち方が変わるか
  const men = kim => ({ race: { venue: '小倉' }, lines: [[1, 2, 3], [4, 5], [7, 8]], riders: [
    { car: 1, score: 112, style: '逃', back: 10 }, { car: 2, score: 110, style: '追' }, { car: 3, score: 106, style: '追' },
    { car: 4, score: 113, style: '両', back: 4, kimarite: kim }, { car: 5, score: 109, style: '追' },
    { car: 7, score: 111, style: '逃', back: 12 }, { car: 8, score: 108, style: '追' }] });
  // 4番が「先行(主導権を取りにいく)」を選んだレースの数
  const senkoRaces = kim => { let n = 0; for (let i = 0; i < 12; i++) { const d = men(kim); for (const r of d.riders) r.score += (rnd() - .5) * 4;
    const e = new PhysicsEngine(toRaceSetup(d)); e.start(); for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    if (e.decisionLogs.some(l => l.riderNumber === 4 && /主導権を握って先行|叩いて主導権/.test(l.message))) n++; } return n; };
  const byNige = senkoRaces({ nige: 7, makuri: 1 }), byMakuri = senkoRaces({ nige: 0, makuri: 8, sashi: 1 });
  check(byNige >= byMakuri + 4, '決まり手の実績が走り方に効く: 逃げの実績なら先行し、捲りの実績なら先行しない', `先行したレース 逃げ実績${byNige} / 捲り実績${byMakuri} (12レース中)`);
  // ガールズ: 実データは 1着の決まり手 逃げ21% / 捲り49% / 差し30% (捲りが一番多い)
  const k = { 逃げ: 0, 捲り: 0, 差し: 0 }; let blocks = false, n = 0;
  for (let i = 0; i < 48; i++) { // (24レースだと偶然のばらつきが大きいので48レース)
    const cars = [1, 2, 3, 4, 5, 6, 7], styles = ['逃', '両', '追'];
    const d = { race: { venue: '小倉', girls: true }, lines: [cars.sort(() => rnd() - .5).slice()], riders: cars.map(car => ({ car, score: +(48 + rnd() * 9).toFixed(1), style: styles[Math.floor(rnd() * 3)] })) };
    const setup = toRaceSetup(d); const e = new PhysicsEngine(setup); e.start();
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    if (e.decisionLogs.some(l => l.action === 'BLOCK')) blocks = true;
    k[e.getStory().kimarite?.how] = (k[e.getStory().kimarite?.how] ?? 0) + 1; n++;
  }
  check(!blocks && k.捲り / n >= 0.3 && k.逃げ / n <= 0.4, 'ガールズ: ブロックなしで、捲りが決まりやすい (実データ 逃げ21/捲り49/差し30)',
    `逃げ${Math.round(k.逃げ / n * 100)}% 捲り${Math.round(k.捲り / n * 100)}% 差し${Math.round(k.差し / n * 100)}%`);
}

// ---------- 7車立て・ライン位置別 (実データは男子7車): ラインがまとまって走り、3番手は強さ次第 ----------
{
  const { toRaceSetup, SAMPLE_RACE_DATA, parseLines } = await import('./race-data.js');
  const { withCondition } = await import('./forecast.js');
  let rs = 11; const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const pos = { 先頭: [0, 0, 0], 番手: [0, 0, 0], '3番手': [0, 0, 0], 単騎: [0, 0, 0] };
  let n = 0, mark2 = 0, chigire = 0, thirds = 0;
  for (const L of ['123/45/67', '45/67/123', '67/123/45', '123/456/7', '12/34/567', '1234/567', '12/345/67']) for (let i = 0; i < 6; i++) {
    const d = structuredClone(SAMPLE_RACE_DATA); d.riders = d.riders.filter(r => r.car <= 7); d.lines = parseLines(L);
    for (const r of d.riders) r.score = +(103 + rnd() * 16).toFixed(1);
    // (画面の「何通りもの未来」と同じく、選手の調子を少しゆらした条件で走らせる)
    const e = new PhysicsEngine(withCondition(toRaceSetup(d), 7000 + n).setup); e.start();
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    n++; const st = e.getStory(); if (st.kimarite.marks.includes(e.ranking[1].number)) mark2++;
    const order = e.ranking.map(r => r.number);
    for (const r of e.riders) {
      const p = r.role === 'SOLO' ? '単騎' : r.linePosition === 0 ? '先頭' : r.linePosition === 1 ? '番手' : '3番手';
      const o = order.indexOf(r.number) + 1; pos[p][0]++; if (o === 1) pos[p][1]++; if (o <= 3) pos[p][2]++;
      if (p === '3番手') { thirds++; if (e.decisionLogs.some(l => l.riderNumber === r.number && /千切れ/.test(l.message))) chigire++; }
    }
  }
  const r = (p, k) => pos[p][k] / pos[p][0];
  check(mark2 / n >= 0.28, '2着が「マーク」(1着の選手の後ろに付いていた選手) になる割合が実データに近い (実際S級40.6%)', `${Math.round(mark2 / n * 100)}%`);
  check(r('先頭', 1) >= 0.14 && r('先頭', 1) <= 0.30 && r('番手', 1) >= 0.08 && r('番手', 1) <= 0.22 && r('3番手', 2) >= 0.18 && r('単騎', 1) <= 0.2,
    '7車立てのライン位置別成績が実データに近い (実際 先頭21.6/49.2 番手14.9/46.9 3番手2.6/32.5 単騎6.8/25.7)',
    Object.entries(pos).map(([p, [c, w, t]]) => `${p} ${Math.round(w / c * 100)}/${Math.round(t / c * 100)}`).join(' '));
  check(chigire > 0 && chigire / thirds <= 0.3, '3番手はときどき千切れる (前の踏み出しに遅れて口が空く)', `3番手${thirds}人中${chigire}人`);

  // 3番手の強さ: 強い3番手はラインで上位を独占し、弱い3番手は着外になりやすい
  const third = score => { let top3 = 0; for (let i = 0; i < 8; i++) {
    const d = { race: { venue: '小倉' }, lines: [[1, 2, 3], [4, 5], [6, 7]], riders: [{ car: 1, score: 114 + i % 3, style: '逃', back: 14 }, { car: 2, score: 110, style: '追' }, { car: 3, score: score + (i % 4) * .5, style: '追' },
      { car: 4, score: 112, style: '両' }, { car: 5, score: 108, style: '追' }, { car: 6, score: 111, style: '両' }, { car: 7, score: 107, style: '追' }] };
    const e = new PhysicsEngine(toRaceSetup(d)); e.start(); for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    if (e.ranking.slice(0, 3).some(r => r.number === 3)) top3++; } return top3; };
  const weak = third(100), strong = third(112);
  check(strong >= weak + 3, '3番手は強さ次第: 強い3番手は3着に絡み、弱い3番手は着外になりやすい', `3着内 強い${strong}/8 弱い${weak}/8`);
}

console.log(failures ? `\n${failures}件 失敗` : '\nすべて合格');
process.exit(failures ? 1 : 0);
