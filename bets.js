// KEIRIN FLOW — 買い方ごとの買い目と「当たる見込み」
//
// 何通りもの未来から作った3連単の確率 (prob.js) を、買い方ごとにまとめ直す。
//   3連単・2車単 … 着順どおり / 3連複・2車複 … 順番は関係なし / ワイド … 2人とも3着以内
// それぞれ確率の高い順に決まった点数を選び、「その買い目のどれかが当たる見込み」を出す。
// 見込みは、選んだ買い目のどれかが当たる着順の確率を全部足したもの (重なりは1回だけ数える)。
import { buildModel, trifectaTable } from './prob.js';
import { formationText } from './formation.js';

export const BET_TYPES = [
  { id: 'trio', label: '3連複', points: 4, desc: '1〜3着に来る3人を当てる (順番は関係なし)。3連単より当たりやすい' },
  { id: 'wide', label: 'ワイド', points: 3, desc: '選んだ2人が、どちらも3着以内に入れば当たり。一番当たりやすい' },
  { id: 'quinella', label: '2車複', points: 3, desc: '1着と2着の2人を当てる (順番は関係なし)' },
  { id: 'exacta', label: '2車単', points: 4, desc: '1着と2着を、順番どおりに当てる' },
  { id: 'trifecta', label: '3連単', points: 6, desc: '1〜3着を、順番どおりに当てる。一番難しいが配当は大きい' }
];
export const BET_LABEL = Object.fromEntries(BET_TYPES.map(b => [b.id, b.label]));

const sortNum = arr => [...arr].sort((a, b) => a - b);
// 1つの買い目が、実際の1〜3着 [a,b,c] で当たりか
export function betHits(type, key, [a, b, c]) {
  const k = key.split('-').map(Number);
  switch (type) {
    case 'trifecta': return k[0] === a && k[1] === b && k[2] === c;
    case 'exacta': return k[0] === a && k[1] === b;
    case 'trio': return sortNum(k).join('-') === sortNum([a, b, c]).join('-');
    case 'quinella': return sortNum(k).join('-') === sortNum([a, b]).join('-');
    case 'wide': return k.every(x => x === a || x === b || x === c);
    default: return false;
  }
}

// 3連単の確率表から、買い方ごとの組み合わせと確率を作る
function combos(table, type) {
  const m = new Map();
  const add = (key, p) => m.set(key, (m.get(key) ?? 0) + p);
  for (const { cars: [a, b, c], p } of table) {
    if (type === 'trifecta') add(`${a}-${b}-${c}`, p);
    else if (type === 'exacta') add(`${a}-${b}`, p);
    else if (type === 'trio') add(sortNum([a, b, c]).join('-'), p);
    else if (type === 'quinella') add(sortNum([a, b]).join('-'), p);
    else if (type === 'wide') { for (const pr of [[a, b], [a, c], [b, c]]) add(sortNum(pr).join('-'), p); }
  }
  return [...m.entries()].map(([key, p]) => ({ key, p })).sort((x, y) => y.p - x.p);
}

// 何通りもの未来 (着順の一覧) から、買い方ごとのおすすめ
export function buildBets(orders, cars = null) {
  if (!orders?.length) return null;
  const cs = cars ?? [...new Set(orders.flat())].sort((a, b) => a - b);
  const table = trifectaTable(buildModel(orders, cs), cs);
  const win = {};
  for (const x of table) win[x.cars[0]] = (win[x.cars[0]] ?? 0) + x.p;
  const axis = Number(Object.entries(win).sort((a, b) => b[1] - a[1])[0][0]);
  const types = {};
  for (const bt of BET_TYPES) {
    const list = combos(table, bt.id).slice(0, bt.points);
    // 当たる見込み: 選んだ買い目のどれかが当たる着順の確率の合計
    const hit = table.reduce((s, x) => s + (list.some(t => betHits(bt.id, t.key, x.cars)) ? x.p : 0), 0);
    types[bt.id] = { ...bt, tickets: list, hit };
  }
  const topEx = combos(table, 'exacta')[0]?.p ?? 0;
  return { cars: cs, table, win, axis, axisWin: win[axis], types, confidence: confidenceOf(topEx), topExacta: topEx, topTrifecta: table[0]?.p ?? 0 };
}

// レースの固さ: 一番ありそうな2車単の確率で決める (実際の2車単1番人気が当たるのは2割ほど)
export function confidenceOf(topExacta) {
  return topExacta >= 0.28 ? { label: 'かたい', cls: 'hi', note: '本命の決着になりやすい' }
    : topExacta >= 0.17 ? { label: '本線有力', cls: 'mid', note: '本線が一番ありそうだが、ほかの決着も十分ある' }
    : { label: '混戦', cls: 'lo', note: 'どの決着もありうる。点数を広げるか、当たりやすい買い方で' };
}

// コピー用
export function betsText(bets, type) {
  const t = bets?.types?.[type];
  if (!t) return '';
  return `${t.label} ${t.tickets.length}点 (当たる見込み 約${Math.round(t.hit * 100)}%)\n${formationText(t.tickets.map(x => x.key), type, bets.cars)}`;
}
