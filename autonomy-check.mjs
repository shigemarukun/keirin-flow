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
  while (!e.riders.every(r => r.finished) && t < 200) {
    e.update(frame); t += frame;
    for (const r of e.riders) {
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
    finished: e.ranking.length,
    reverse, minCorridorGap,
    logs: e.decisionLogs.map(d => ({ n: d.riderNumber, a: d.action, m: d.message }))
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
check(a.minCorridorGap >= 13.5 - 1e-6, '同じ走路で13.5m未満に重ならない', a.minCorridorGap.toFixed(2));

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

console.log(failures ? `\n${failures}件 失敗` : '\nすべて合格');
process.exit(failures ? 1 : 0);
