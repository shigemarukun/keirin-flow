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
  // 作戦もレースごとに変わる: 前受けになったら 突っ張る / 引く / 中団 を、その選手のくせ(割合)で選ぶ。
  // かましの多い選手は、ときどきカマシに出る (ユーザーが指定していれば、その指定のまま)
  const plans = {};
  for (const [car, r] of Object.entries(s.riders)) {
    // (割合で選ぶのは、EXデータから割合が出ている選手だけ。無い選手は、その場で相手と比べて決める)
    if (!r.frontResponse && r.frontPlanProbs && r.frontPlanFromEx && (globalThis.KF_TUNE?.fp ?? 1)) {
      let x = rnd(), pick = null;
      for (const [plan, p] of Object.entries(r.frontPlanProbs)) { x -= p; if (x <= 0) { pick = plan; break; } }
      r.frontPlan = pick ?? 'HIKU';
      if (r.mindset) r.mindset = r.frontPlan === 'TSUPPARI' ? 'TSUPPARI' : r.frontPlan === 'CHUDAN' ? 'YIELD_AND_ROLL' : 'CONTAIN';
      plans[car] = r.frontPlan;
    }
    if (!r.tactic && r.kamashiFreq != null && rnd() < r.kamashiFreq * 1.5) r.tacticPlan = 'KAMASHI';
  }
  return { setup: s, condition, plans };
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
      backLeader: e.recorder.snapshots.back?.order?.[0] ?? null,
      chigire: [...new Set(logs.filter(l => /千切れ/.test(l.message)).map(l => l.riderNumber))]
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
  const chigire = Object.fromEntries(cars.map(c => [c, 0]));
  const runs = [];
  for (let i = 0; i < n; i++) {
    const runSeed = seed + i * 7919;
    const { setup: s, condition, plans } = withCondition(setup, runSeed);
    const r = runRace(s);
    const order = r.ranking.map(x => x.number);
    // 展開: 最終ホームで先頭を走っていた選手のライン (= 主導権を取ったライン) と、前受けの動き
    const home = r.snapshots.home?.order?.[0] ?? null;
    const mainLine = home == null ? null : (setup.lines.find(l => l.members.includes(home))?.leader ?? home);
    const frontCar = setup.formation?.[0]?.[0];
    runs.push({ seed: runSeed, order, kimarite: r.kimarite, story: r.story, condition, mainLine, frontPlan: setup.riders[frontCar]?.frontResponse ?? plans?.[frontCar] ?? null, frontCar });
    win[order[0]]++; for (const c of order.slice(0, 2)) top2[c]++; for (const c of order.slice(0, 3)) top3[c]++;
    const ex = `${order[0]}-${order[1]}`, tri = `${order[0]}-${order[1]}-${order[2]}`;
    exacta.set(ex, (exacta.get(ex) ?? 0) + 1); trifecta.set(tri, (trifecta.get(tri) ?? 0) + 1);
    const k = r.kimarite?.how ?? '不明';
    kimarite.set(k, (kimarite.get(k) ?? 0) + 1);
    if (r.events.backLeader != null) backLeader.set(r.events.backLeader, (backLeader.get(r.events.backLeader) ?? 0) + 1);
    if (r.events.tsuppari) tsuppari++;
    if (r.events.cutSucceeded) cut++;
    for (const c of r.events.chigire ?? []) chigire[c] = (chigire[c] ?? 0) + 1;
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
    branches: { tsuppari: tsuppari / n, cutSucceeded: cut / n },
    chigire: rate(chigire)
  };
}

// よく起きる展開を「本線 / 対抗 / 穴」としてまとめる。
// 1-2着の組み合わせが同じ未来をひとまとめにして、多い順に3つ。
// それぞれ、その中で一番よく出た3着までの並びになった1回を代表にする (その回をコースで再生できる)。
const PLAN_LABEL = { TSUPPARI: '突っ張る', HIKU: '引く', CHUDAN: '中団を取る' };
export function pickScenarios(runs, n) {
  // 展開 (どのラインが主導権を取ったか) ごとにまとめる。主導権が分からない古いデータは、着順でまとめる
  const groups = new Map();
  for (const r of runs) {
    const key = r.mainLine != null ? `L${r.mainLine}` : `${r.order[0]}-${r.order[1]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const labels = ['本線', '対抗', '穴'];
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, list], i) => {
      // その展開の中で一番多かった1-2着、さらにその中で一番多かった3着までの並びを代表にする
      const count = (arr, f) => { const m = new Map(); for (const r of arr) m.set(f(r), (m.get(f(r)) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
      const [bestEx, exCount] = count(list, r => `${r.order[0]}-${r.order[1]}`)[0];
      const inEx = list.filter(r => `${r.order[0]}-${r.order[1]}` === bestEx);
      const bestTri = count(inEx, r => r.order.slice(0, 3).join('-'))[0][0];
      const rep = inEx.find(r => r.order.slice(0, 3).join('-') === bestTri);
      // 展開の名前: 「8番ラインが主導権」+ 前受けの動き (いちばん多かったもの)
      const plan = count(list.filter(r => r.frontPlan), r => r.frontPlan)[0]?.[0];
      const theme = key.startsWith('L') ? `${key.slice(1)}番ラインが主導権${plan && rep.frontCar != null ? ` (前受け${rep.frontCar}番は${PLAN_LABEL[plan] ?? plan})` : ''}` : null;
      // この展開になったときの、調子の目立つ選手 (平均)
      const cond = {};
      for (const r of list) for (const [car, c] of Object.entries(r.condition)) cond[car] = (cond[car] ?? 0) + c / list.length;
      const notable = Object.entries(cond).filter(([, c]) => Math.abs(c) >= 0.012).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
        .map(([car, c]) => ({ car: Number(car), condition: c }));
      return { label: labels[i], theme, exacta: bestEx, exactaCount: exCount, count: list.length, rate: list.length / n, seed: rep.seed, order: rep.order, kimarite: rep.kimarite, story: rep.story, notable };
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
