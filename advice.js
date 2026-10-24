// KEIRIN FLOW — 展開ごとの買い目アドバイス (3連単)
//
// 選んだ展開 (主導権を取ったライン) と同じ展開になった回だけを集め、1〜3着に誰が来やすいかを数える。
// 回数が少ないので、全体の結果で少しならしてから、3連単のすべての組み合わせに点数を付ける。
// 点数は「上から足して約6割を押さえられる数」(固い展開ほど少なく、荒れる展開ほど多い。3〜24点)。
// 本命 / 抑え / 穴 (印の薄い選手が絡む組み合わせ) に分け、その展開で起きやすいことを文章で添える。
// オッズはまだ使わない (穴はAIの見立てで確率が低いもの)。

const SMOOTH = 4;      // 全体の結果で、どのくらいならすか (回数に換算)
const COVER = 0.6;     // 押さえたい割合
const MIN_POINTS = 3, MAX_POINTS = 24;

export function buildAdvice({ runs, scenario, marks = {}, names = {} }) {
  if (!runs?.length) return null;
  const cars = [...new Set(runs.flatMap(r => r.order))].sort((a, b) => a - b);
  const group = scenario?.mainLine != null ? runs.filter(r => r.mainLine === scenario.mainLine) : runs;
  if (!group.length) return null;
  const nG = group.length, nAll = runs.length;
  // 着順ごとの確率 (この展開の回 + 全体で少しならす)
  const posProb = k => Object.fromEntries(cars.map(c => {
    const g = group.filter(r => r.order[k] === c).length, a = runs.filter(r => r.order[k] === c).length / nAll;
    return [c, (g + SMOOTH * a) / (nG + SMOOTH)];
  }));
  const p1 = posProb(0), p2 = posProb(1), p3 = posProb(2);
  const seen = new Map();
  for (const r of group) { const k = r.order.slice(0, 3).join('-'); seen.set(k, (seen.get(k) ?? 0) + 1); }
  // 3連単の点数: 1着の確率 × (1着を除いた中での2着の確率) × (残りの中での3着の確率) + 実際に出た回数
  const scored = [];
  for (const a of cars) for (const b of cars) for (const c of cars) {
    if (a === b || b === c || a === c) continue;
    const model = p1[a] * (p2[b] / Math.max(0.05, 1 - p2[a])) * (p3[c] / Math.max(0.05, 1 - p3[a] - p3[b]));
    scored.push({ key: `${a}-${b}-${c}`, cars: [a, b, c], score: 0.6 * model + 0.4 * ((seen.get(`${a}-${b}-${c}`) ?? 0) / nG) });
  }
  const total = scored.reduce((s, x) => s + x.score, 0) || 1;
  for (const x of scored) x.p = x.score / total;
  scored.sort((x, y) => y.p - x.p);
  // 画面に出している展開の着順 (代表の1回) は、必ず本命の先頭に置く
  const repKey = scenario?.order?.slice(0, 3).join('-');
  const repIdx = scored.findIndex(x => x.key === repKey);
  if (repIdx > 0) scored.unshift(scored.splice(repIdx, 1)[0]);
  // 何点買うか: 上から足して約6割に届くまで (3〜24点)
  let cum = 0, points = 0;
  while (points < scored.length && cum < COVER) cum += scored[points++].p;
  points = Math.max(MIN_POINTS, Math.min(MAX_POINTS, points));
  const strong = new Set(Object.entries(marks).filter(([, m]) => ['◎', '○', '▲'].includes(m)).map(([c]) => Number(c)));
  // 本命: 上から3割ぶん (1〜6点) / 穴: 印の薄い選手が絡む組み合わせから (点数の約1/4) / 抑え: 残り
  const honmei = []; let c1 = 0;
  for (const x of scored) { if (honmei.length >= 6 || (honmei.length >= 1 && c1 >= 0.3)) break; honmei.push(x); c1 += x.p; }
  const anaN = Math.max(1, Math.round(points / 4));
  const rest = scored.slice(honmei.length, 80);
  const ana = rest.filter(x => x.cars.slice(0, 2).some(c => !strong.has(c)) && x.p >= scored[0].p * 0.08).slice(0, anaN);
  const osae = rest.filter(x => !ana.includes(x)).slice(0, Math.max(0, points - honmei.length - ana.length));
  const pick = arr => arr.map(x => ({ key: x.key, p: x.p }));
  return {
    points: honmei.length + osae.length + ana.length,
    cover: [...honmei, ...osae, ...ana].reduce((s, x) => s + x.p, 0),
    difficulty: points <= 6 ? '固い' : points <= 14 ? 'ふつう' : '荒れそう',
    honmei: pick(honmei), osae: pick(osae), ana: pick(ana),
    notes: nG >= 5 ? notesFor(group, nG, names) : [],
    n: nG, nAll,
    thin: nG < 5 // この展開になった回が少なく、根拠が弱い
  };
}

// その展開で起きやすいこと
function notesFor(group, nG, names) {
  const nm = c => `${c}番${names[c] ? names[c].replace(/\s/g, '') : ''}`;
  const notes = [];
  const count = f => group.filter(f).length;
  const how = {};
  for (const r of group) if (r.how) how[r.how] = (how[r.how] ?? 0) + 1;
  const topHow = Object.entries(how).sort((a, b) => b[1] - a[1])[0];
  if (topHow) notes.push(`決まり手は「${topHow[0]}」が多い (${nG}回中${topHow[1]}回)`);
  const tally = key => { const m = {}; for (const r of group) for (const c of r.ev?.[key] ?? []) m[c] = (m[c] ?? 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  for (const [c, k] of tally('kamashi').slice(0, 1)) if (k / nG >= 0.3) {
    const won = count(r => (r.ev?.kamashi ?? []).includes(Number(c)) && r.order.slice(0, 3).includes(Number(c)));
    notes.push(`${nm(c)}がカマしに出やすい (${nG}回中${k}回)。カマして3着以内は${won}回`);
  }
  for (const [c, k] of tally('makuri').slice(0, 1)) if (k / nG >= 0.3) {
    const won = count(r => (r.ev?.makuri ?? []).includes(Number(c)) && r.order[0] === Number(c));
    notes.push(`${nm(c)}が捲りに出やすい (${nG}回中${k}回)。捲って1着は${won}回`);
  }
  for (const [c, k] of tally('banteMakuriBy').slice(0, 1)) if (k / nG >= 0.2) notes.push(`${nm(c)}の番手捲りがある (${nG}回中${k}回)`);
  for (const [c, k] of tally('chigire').slice(0, 2)) if (k / nG >= 0.25) notes.push(`${nm(c)}は千切れやすい (${nG}回中${k}回)。3着の押さえに入れるかは慎重に`);
  return notes.slice(0, 4);
}

// コピー用の文字 (投票アプリに打ち込むときのメモ)
export function adviceText(advice, label = '') {
  if (!advice) return '';
  const line = (t, arr) => (arr.length ? `${t}: ${groupedKeys(arr).join(' / ')}` : '');
  return [`${label}3連単 ${advice.points}点`, line('本命', advice.honmei), line('抑え', advice.osae), line('穴', advice.ana)].filter(Boolean).join('\n');
}

// 1・2着が同じ組み合わせをまとめた書き方 (例: 2-4-9,5,1)。投票アプリに入れるときに見やすい
export function groupedKeys(arr) {
  const m = new Map();
  for (const x of arr) { const [a, b, c] = x.key.split('-'); const k = `${a}-${b}`; if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
  return [...m.entries()].map(([k, cs]) => `${k}-${cs.join(',')}`);
}
