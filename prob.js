// KEIRIN FLOW — 3連単の確率モデル
//
// 何通りもの未来 (シミュレーションの着順) から、3連単すべての組み合わせに確率を付ける。
//   P(a-b-c) = P(1着 a) × P(2着 b | 1着 a) × P(3着 c | 1着 a・2着 b)
// それぞれの段で「その条件になった回の実際の結果」を数え、回数が少ないぶんだけ
// ひとつ上の大まかな見立て (2着なら「2着になりやすさ」) に寄せてならす。
// こうすると「1着が先行なら2着は番手」のようなラインのつながりが残り、
// 30回ほどの未来で一度も出なかった組み合わせにも、ありそうな分だけ確率が付く。
//
// (Plackett–Luce (選手ごとの強さだけで決める式) も試したが、ラインのつながりを表せず、
//  別に走らせた未来の当たり具合 (対数損失) が悪かったので使っていない。tools/prob-check.mjs)

export const SMOOTH = Object.freeze({ first: 0.5, second: 8, third: 6, scenario: 4 });

const cnt = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
const norm = o => { const z = Object.values(o).reduce((a, b) => a + b, 0) || 1; for (const k in o) o[k] /= z; return o; };

// orders: 各回の着順 (1着から順の車番)。base: ならす先のモデル (無ければ、着ごとのなりやすさ)
export function buildModel(orders, cars, { base = null, s = SMOOTH } = {}) {
  const n = orders.length;
  const posRate = k => { const c = cnt(orders, o => o[k]); return Object.fromEntries(cars.map(x => [x, ((c.get(x) ?? 0) + s.first) / (n + s.first * cars.length)])); };
  const p2m = posRate(1), p3m = posRate(2);
  const c1 = cnt(orders, o => o[0]), c12 = cnt(orders, o => `${o[0]}-${o[1]}`), c123 = cnt(orders, o => o.slice(0, 3).join('-'));
  const first = {};
  for (const a of cars) first[a] = base ? ((c1.get(a) ?? 0) + s.scenario * base.first[a]) / (n + s.scenario) : ((c1.get(a) ?? 0) + s.first) / (n + s.first * cars.length);
  const second = {}, third = {};
  for (const a of cars) {
    // 2着: 1着が a の回で、誰が2着だったか (少なければ、全体の見立て/2着のなりやすさに寄せる)
    const prior = base ? base.second[a] : norm(Object.fromEntries(cars.filter(b => b !== a).map(b => [b, p2m[b]])));
    const na = c1.get(a) ?? 0;
    second[a] = Object.fromEntries(cars.filter(b => b !== a).map(b => [b, ((c12.get(`${a}-${b}`) ?? 0) + s.second * prior[b]) / (na + s.second)]));
    for (const b of cars) {
      if (b === a) continue;
      const prior3 = base ? base.third[`${a}-${b}`] : norm(Object.fromEntries(cars.filter(c => c !== a && c !== b).map(c => [c, p3m[c]])));
      const nab = c12.get(`${a}-${b}`) ?? 0;
      third[`${a}-${b}`] = Object.fromEntries(cars.filter(c => c !== a && c !== b).map(c => [c, ((c123.get(`${a}-${b}-${c}`) ?? 0) + s.third * prior3[c]) / (nab + s.third)]));
    }
  }
  return { first: norm(first), second, third, n };
}

// 3連単すべての確率 (大きい順)
export function trifectaTable(model, cars) {
  const out = [];
  for (const a of cars) for (const b of cars) for (const c of cars) {
    if (a === b || b === c || a === c) continue;
    out.push({ key: `${a}-${b}-${c}`, cars: [a, b, c], p: model.first[a] * model.second[a][b] * model.third[`${a}-${b}`][c] });
  }
  return out.sort((x, y) => y.p - x.p);
}

// 展開 (主導権を取ったライン) ごとのモデル: その展開になった回で数え、全体のモデルに寄せる
export function scenarioModel(allOrders, groupOrders, cars) {
  const base = buildModel(allOrders, cars);
  return groupOrders ? buildModel(groupOrders, cars, { base }) : base;
}
