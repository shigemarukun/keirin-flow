// KEIRIN FLOW — 3連単の確率の当たり具合を確かめる
//
//   node tools/prob-check.mjs        # 出走表10通り × (予想に30回 / 答え合わせに別の200回)
//
// 予想 (画面と同じ30回の未来) で付けた3連単の確率が、別に走らせた200回の結果にどれだけ合っているかを
// 対数損失 (小さいほど良い。実際に起きた組み合わせに高い確率を付けていたほど小さい) で比べる。
//   旧: 着ごとのなりやすさを掛け合わせる式 (これまでの advice.js)
//   PL: Plackett–Luce (選手ごとの強さだけで決める式)
//   新: 1着 → 2着 → 3着 を、その条件になった回の結果で数えて、ならす式 (prob.js)
import { makeRace } from './bench.mjs?lib';
import { toRaceSetup } from '../race-data.js';
import { withCondition, runRace } from '../forecast.js';
import { buildModel, trifectaTable } from '../prob.js';

const NF = +(process.env.NF ?? 30), NT = +(process.env.NT ?? 200), CARDS = +(process.env.CARDS ?? 10);
const ll = p => -Math.log(Math.max(1e-4, p ?? 0));
const sum = { 旧: 0, PL: 0, 新: 0, 新_展開別: 0 }; let n = 0, nS = 0, sumS = { 旧: 0, 新: 0 };

function oldTable(orders, cars) {
  const N = orders.length, pos = k => Object.fromEntries(cars.map(c => { const g = orders.filter(o => o[k] === c).length; return [c, (g + 4 * g / N) / (N + 4)]; }));
  const p1 = pos(0), p2 = pos(1), p3 = pos(2), seen = new Map();
  for (const o of orders) { const k = o.slice(0, 3).join('-'); seen.set(k, (seen.get(k) ?? 0) + 1); }
  const m = new Map(); let tot = 0;
  for (const a of cars) for (const b of cars) for (const c of cars) {
    if (a === b || b === c || a === c) continue;
    const s = 0.6 * p1[a] * (p2[b] / Math.max(0.05, 1 - p2[a])) * (p3[c] / Math.max(0.05, 1 - p3[a] - p3[b])) + 0.4 * ((seen.get(`${a}-${b}-${c}`) ?? 0) / N);
    m.set(`${a}-${b}-${c}`, s); tot += s;
  }
  for (const [k, v] of m) m.set(k, v / tot);
  return m;
}
function plTable(orders, cars) {
  const w = Object.fromEntries(cars.map(c => [c, 1]));
  for (let it = 0; it < 60; it++) {
    const wins = Object.fromEntries(cars.map(c => [c, 1])), den = Object.fromEntries(cars.map(c => [c, cars.length / 1]));
    for (const o of orders) { let rest = o.reduce((s, c) => s + w[c], 0); for (let t = 0; t < 4; t++) { wins[o[t]]++; for (let k = t; k < o.length; k++) den[o[k]] += 1 / rest; rest -= w[o[t]]; } }
    for (const c of cars) w[c] = wins[c] / den[c];
  }
  const S = Object.values(w).reduce((a, b) => a + b, 0), m = new Map();
  for (const a of cars) for (const b of cars) for (const c of cars) if (a !== b && b !== c && a !== c) m.set(`${a}-${b}-${c}`, (w[a] / S) * (w[b] / (S - w[a])) * (w[c] / (S - w[a] - w[b])));
  return m;
}

for (let k = 0; k < CARDS; k++) {
  const setup = toRaceSetup(makeRace(200 + k, { cars: 7 }));
  const cars = Object.keys(setup.riders).map(Number);
  const sim = seed => { const r = runRace(withCondition(setup, seed).setup); const home = r.snapshots.home?.order?.[0]; return { order: r.ranking.map(x => x.number), main: home == null ? null : (setup.lines.find(l => l.members.includes(home))?.leader ?? home) }; };
  const fr = Array.from({ length: NF }, (_, i) => sim(1000 + i * 7919));
  const test = Array.from({ length: NT }, (_, i) => sim(900000 + i * 31));
  const orders = fr.map(r => r.order);
  const T = { 旧: oldTable(orders, cars), PL: plTable(orders, cars), 新: new Map(trifectaTable(buildModel(orders, cars), cars).map(x => [x.key, x.p])) };
  const base = buildModel(orders, cars);
  for (const t of test) {
    const key = t.order.slice(0, 3).join('-'); n++;
    for (const m of ['旧', 'PL', '新']) sum[m] += ll(T[m].get(key));
    // 展開別: その回と同じ展開 (主導権ライン) の予想だけで付けた確率
    const g = fr.filter(r => r.main === t.main).map(r => r.order);
    if (g.length >= 3) {
      nS++;
      sumS.旧 += ll(oldTable(g, cars).get(key));
      sumS.新 += ll(new Map(trifectaTable(buildModel(g, cars, { base }), cars).map(x => [x.key, x.p])).get(key));
    }
  }
}
console.log(`出走表${CARDS}通り / 予想${NF}回 / 答え合わせ${NT}回ずつ — 3連単の対数損失 (小さいほど良い)`);
for (const m of ['旧', 'PL', '新']) console.log(`  レース全体  ${m}: ${(sum[m] / n).toFixed(3)}`);
for (const m of ['旧', '新']) console.log(`  展開ごと    ${m}: ${(sumS[m] / nS).toFixed(3)}  (n=${nS})`);
