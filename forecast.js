// KEIRIN FLOW — AIの展開予想 (画面に出さずにレースを走らせて、結果をまとめる)
//
// predictRace(setup)          : 能力どおりの1レースを走らせて、展開の文章・着順・決まり手を返す (AIの本命予想)
// forecastRaces(setup, n)     : 選手の「調子」を少しずつ変えて n 回走らせ、1着率・3着内率・よくある展開を返す
//                               ("Where Every Race Has a Thousand Futures")
//
// 乱数は種(seed)から作るので、同じ出走表なら何度やっても同じ予想になる。

import { PhysicsEngine } from './engine.js';

const STEP = 1 / 120;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = rnd => { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// 選手ごとの「調子」: 地力・加速・持久力を ±数% ゆらす (その日の出来)
export function withCondition(setup, seed, spread = 0.03) {
  const rnd = mulberry32(seed);
  const s = structuredClone(setup);
  const condition = {};
  for (const [car, r] of Object.entries(s.riders)) {
    const c = gaussian(rnd) * spread;
    condition[car] = c;
    for (const key of ['power', 'acceleration', 'endurance']) r[key] = Math.min(1.05, Math.max(0.3, (r[key] ?? 0.8) * (1 + c + gaussian(rnd) * spread * 0.4)));
    delete r.topSpeed; delete r.sprintBonus; // 能力から速度を計算し直す
  }
  return { setup: s, condition };
}

export function runRace(setup) {
  const e = new PhysicsEngine(setup);
  e.start();
  let t = 0;
  while (!e.riders.every(r => r.finished) && t < 160) { e._step(STEP); t += STEP; }
  e._finalizeRanking();
  const { story, kimarite } = e.getStory();
  const logs = e.decisionLogs;
  const has = re => logs.some(l => re.test(l.message));
  return {
    ranking: e.ranking.map(r => ({ number: r.number, time: r.time })),
    story, kimarite,
    snapshots: e.recorder.snapshots,
    prediction: e.getPrediction(),
    events: {
      tsuppari: has(/突っ張る/) && !has(/踏み勝って前に出る|叩き切る/) ,
      cutSucceeded: has(/誘導切り成功|叩き切る/),
      blocked: has(/牽制/),
      banteMakuri: has(/番手捲り/),
      backLeader: e.recorder.snapshots.back?.order?.[0] ?? null
    }
  };
}

export function predictRace(setup) {
  return runRace(setup);
}

export function forecastRaces(setup, n = 40, { seed = 20261024, onProgress } = {}) {
  const cars = Object.keys(setup.riders).map(Number);
  const win = Object.fromEntries(cars.map(c => [c, 0]));
  const top2 = Object.fromEntries(cars.map(c => [c, 0]));
  const top3 = Object.fromEntries(cars.map(c => [c, 0]));
  const exacta = new Map(), trifecta = new Map(), kimarite = new Map(), backLeader = new Map();
  let tsuppari = 0, cut = 0;
  const runs = [];
  for (let i = 0; i < n; i++) {
    const runSeed = seed + i * 7919;
    const { setup: s, condition } = withCondition(setup, runSeed);
    const r = runRace(s);
    const order = r.ranking.map(x => x.number);
    runs.push({ seed: runSeed, order, kimarite: r.kimarite, story: r.story, condition });
    win[order[0]]++; for (const c of order.slice(0, 2)) top2[c]++; for (const c of order.slice(0, 3)) top3[c]++;
    const ex = `${order[0]}-${order[1]}`, tri = `${order[0]}-${order[1]}-${order[2]}`;
    exacta.set(ex, (exacta.get(ex) ?? 0) + 1); trifecta.set(tri, (trifecta.get(tri) ?? 0) + 1);
    const k = r.kimarite?.how ?? '不明';
    kimarite.set(k, (kimarite.get(k) ?? 0) + 1);
    if (r.events.backLeader != null) backLeader.set(r.events.backLeader, (backLeader.get(r.events.backLeader) ?? 0) + 1);
    if (r.events.tsuppari) tsuppari++;
    if (r.events.cutSucceeded) cut++;
    onProgress?.(i + 1, n);
  }
  const top = (map, k) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([key, count]) => ({ key, rate: count / n }));
  const rate = obj => Object.fromEntries(Object.entries(obj).map(([c, v]) => [c, v / n]));
  return {
    n,
    scenarios: pickScenarios(runs, n),
    marks: marksFrom(rate(win), rate(top3)),
    win: rate(win), top2: rate(top2), top3: rate(top3),
    exacta: top(exacta, 5), trifecta: top(trifecta, 5),
    kimarite: top(kimarite, 3),
    backLeader: top(backLeader, 3),
    branches: { tsuppari: tsuppari / n, cutSucceeded: cut / n }
  };
}

// よく起きる展開を「本線 / 対抗 / 穴」としてまとめる。
// 1-2着の組み合わせが同じ未来をひとまとめにして、多い順に3つ。
// それぞれ、その中で一番よく出た3着までの並びになった1回を代表にする (その回をコースで再生できる)。
export function pickScenarios(runs, n) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.order[0]}-${r.order[1]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const labels = ['本線', '対抗', '穴'];
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, list], i) => {
      const tri = new Map();
      for (const r of list) { const t = r.order.slice(0, 3).join('-'); tri.set(t, (tri.get(t) ?? 0) + 1); }
      const bestTri = [...tri.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const rep = list.find(r => r.order.slice(0, 3).join('-') === bestTri);
      // この展開になったときの、調子の目立つ選手 (平均)
      const cond = {};
      for (const r of list) for (const [car, c] of Object.entries(r.condition)) cond[car] = (cond[car] ?? 0) + c / list.length;
      const notable = Object.entries(cond).filter(([, c]) => Math.abs(c) >= 0.012).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
        .map(([car, c]) => ({ car: Number(car), condition: c }));
      return { label: labels[i], exacta: key, count: list.length, rate: list.length / n, seed: rep.seed, order: rep.order, kimarite: rep.kimarite, story: rep.story, notable };
    });
}

// 印: 1着になりやすい順に ◎ ○ ▲、残りで3着以内に入りやすい2人に △
export function marksFrom(win, top3) {
  const cars = Object.keys(win).map(Number);
  const byWin = [...cars].sort((a, b) => (win[b] - win[a]) || (top3[b] - top3[a]) || a - b);
  const marks = {};
  ['◎', '○', '▲'].forEach((m, i) => { if (byWin[i] != null && (win[byWin[i]] > 0 || top3[byWin[i]] > 0)) marks[byWin[i]] = m; });
  cars.filter(c => !marks[c]).sort((a, b) => (top3[b] - top3[a]) || a - b).slice(0, 2).forEach(c => { if (top3[c] > 0.15) marks[c] = '△'; });
  return marks;
}
