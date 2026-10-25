// KEIRIN FLOW — 答え合わせの採点
//
// レースの前に「予想を確定」して保存し、結果が出てから採点する。
// 結果を見たあとで予想を作り直すと、どうしても良く見えてしまうので、確定した予想だけを通算の成績に数える。
//
// 採点は「当たり/外れ」だけでなく、確率の当たり具合で見る:
//   ・実際の3連単に、AIは何%を付けていたか (全組み合わせの中で何番目か)
//   ・当てずっぽう (全組み合わせが同じ確率) の何倍の確率を付けていたか
//   ・対数損失 −log(その確率)  … 小さいほど良い。何レースかの平均で比べる
//   ・1着のブライアスコア Σ(1着率 − 実際)²  … 0に近いほど良い (全員同じ確率なら約0.86〜0.89)
import { buildModel, trifectaTable } from './prob.js';

// 予想を確定するときに残すもの (未来の着順だけ残せば、確率はあとから同じ式で計算し直せる)
export function makeLock({ setup, forecast, main, advice, adviceLabel, now = new Date() }) {
  const cars = Object.keys(setup?.riders ?? {}).map(Number).sort((a, b) => a - b);
  return {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    lockedAt: now.toISOString(),
    race: setup?.meta?.race ?? {},
    names: setup?.meta?.names ?? {},
    lines: (setup?.formation ?? setup?.lines?.map(l => l.members) ?? []).map(g => [...g]),
    cars,
    fingerprint: fingerprint(setup),
    main: (forecast?.scenarios?.[0]?.order ?? main?.ranking?.map(r => r.number) ?? []).slice(0, 3),
    marks: forecast?.marks ?? {},
    scenarios: (forecast?.scenarios ?? []).map(s => ({ label: s.label, theme: s.theme, rate: s.rate, order: s.order?.slice(0, 3) })),
    orders: (forecast?.runs ?? []).map(r => r.order),
    win: forecast?.win ?? {},
    advice: advice ? { label: adviceLabel ?? '', points: advice.points, honmei: advice.honmei.map(x => x.key), osae: advice.osae.map(x => x.key), ana: advice.ana.map(x => x.key) } : null,
    result: null
  };
}

// 同じレースか見分けるための目印 (車番・得点・並び)
export function fingerprint(setup) {
  if (!setup?.riders) return '';
  const r = Object.entries(setup.riders).map(([c, x]) => `${c}:${x.power ?? ''}`).join(',');
  const l = (setup.formation ?? setup.lines?.map(x => x.members) ?? []).map(g => g.join('')).join('/');
  return `${r}|${l}`;
}

export function scoreLock(lock, actual) {
  const [a1, a2, a3] = actual;
  const cars = lock.cars?.length ? lock.cars : [...new Set(lock.orders.flat())].sort((a, b) => a - b);
  const n = cars.length;
  const combos = n * (n - 1) * (n - 2);
  const table = lock.orders?.length ? trifectaTable(buildModel(lock.orders, cars), cars) : [];
  const key = `${a1}-${a2}-${a3}`;
  const idx = table.findIndex(x => x.key === key);
  const p = idx >= 0 ? table[idx].p : 0;
  const pSafe = Math.max(p, 1e-4);
  // 1着のブライアスコア
  const win = lock.win ?? {};
  const brier = cars.reduce((s, c) => s + ((win[c] ?? 0) - (c === a1 ? 1 : 0)) ** 2, 0);
  const ai = lock.main ?? [];
  const adv = lock.advice;
  const adviceHit = !adv ? null : adv.honmei.includes(key) ? '本命' : adv.osae.includes(key) ? '抑え' : adv.ana.includes(key) ? '波乱' : '';
  return {
    actual: [a1, a2, a3], key,
    p, rank: idx >= 0 ? idx + 1 : null, combos,
    vsRandom: p * combos,           // 当てずっぽうの何倍の確率を付けていたか
    logLoss: -Math.log(pSafe),
    logLossRandom: Math.log(combos), // 当てずっぽうの対数損失
    brier,
    winP: win[a1] ?? 0,
    winHit: ai[0] === a1, exactaHit: ai[0] === a1 && ai[1] === a2, trifectaHit: ai[0] === a1 && ai[1] === a2 && ai[2] === a3,
    adviceHit, advicePoints: adv?.points ?? null
  };
}

// 確定した予想の通算成績 (採点済みのものだけ)
export function summarize(locks) {
  const done = locks.filter(l => l.result);
  if (!done.length) return null;
  const avg = f => done.reduce((s, l) => s + f(l.result), 0) / done.length;
  const withAdv = done.filter(l => l.result.adviceHit != null);
  // あなたの読み (戦法・展開の指定) を入れた予想と、入れなかったAIだけの予想の比べ
  const withAi = done.filter(l => l.result.aiOnly);
  const geo = list => Math.exp(list.reduce((s, x) => s + Math.log(Math.max(x, 1e-4)), 0) / list.length);
  return {
    mine: withAi.length ? {
      n: withAi.length,
      better: withAi.filter(l => l.result.p > l.result.aiOnly.p * 1.5).length,
      worse: withAi.filter(l => l.result.p < l.result.aiOnly.p / 1.5).length,
      vsRandomMine: geo(withAi.map(l => l.result.vsRandom)),
      vsRandomAi: geo(withAi.map(l => l.result.aiOnly.vsRandom))
    } : null,
    n: done.length,
    logLoss: avg(r => r.logLoss),
    logLossRandom: avg(r => r.logLossRandom),
    // 平均で当てずっぽうの何倍の確率を付けていたか (掛け算の平均)
    vsRandom: Math.exp(avg(r => r.logLossRandom - r.logLoss)),
    brier: avg(r => r.brier),
    winHit: avg(r => (r.winHit ? 1 : 0)),
    trifectaHit: avg(r => (r.trifectaHit ? 1 : 0)),
    adviceHit: withAdv.length ? withAdv.filter(l => l.result.adviceHit).length / withAdv.length : null,
    adviceN: withAdv.length,
    advicePoints: withAdv.length ? withAdv.reduce((s, l) => s + (l.result.advicePoints ?? 0), 0) / withAdv.length : null
  };
}
