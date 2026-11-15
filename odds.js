// KEIRIN FLOW — オッズ (みんなの見立て)
//
// オッズは「投票した人みんなが、どの組み合わせをどれくらい買っているか」= 市場の予想。
// 貼り付けたオッズを読み取り、
//   ・本物らしいかを点検する (払戻率から、全組み合わせの 1/オッズ の合計はおよそ決まった値になる)
//   ・みんなの見立て (確率) に直して、AIの見立てと比べる
//   ・3連単を倍率で 本命・中穴・穴 に分ける
// オッズは締め切りまで動くので、いつ時点のものかを必ず一緒に持つ。
// AIの予想 (確率) そのものには、オッズを混ぜない (混ぜ方は、答え合わせが貯まってから決める)。

export const PAYOUT = 0.75; // 競輪の払戻率 (約75%)
export const TIERS = [
  { id: 'honmei', label: '本命', min: 0, max: 30, desc: '30倍未満' },
  { id: 'chuana', label: '中穴', min: 30, max: 100, desc: '30〜100倍' },
  { id: 'ana', label: '穴', min: 100, max: Infinity, desc: '100倍以上 (万車券)' }
];
export const ODDS_TYPES = { trifecta: '3連単', trio: '3連複', exacta: '2車単', quinella: '2車複', wide: 'ワイド' };

const half = s => String(s ?? '').replace(/[０-９．]/g, c => c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[－ー―−→＞>]/g, '-').replace(/[＝]/g, '=').replace(/,/g, '');
const sortKey = arr => [...arr].sort((a, b) => a - b).join('-');

// 文字からオッズを読む。見出し (3連単・2車単…) があればそれに従い、無ければ区切り (- は着順どおり、= は順不同) と人数で決める
export function parseOddsText(text, cars = []) {
  const out = { trifecta: {}, trio: {}, exacta: {}, quinella: {}, wide: {} };
  const carSet = new Set(cars.map(Number));
  let section = null, at = null;
  for (const raw of half(text).split('\n')) {
    const row = raw.trim();
    if (!row) continue;
    const h = row.match(/3連単|三連単|3連複|三連複|2車単|二車単|2車複|二車複|ワイド/);
    if (h) section = { '3連単': 'trifecta', 三連単: 'trifecta', '3連複': 'trio', 三連複: 'trio', '2車単': 'exacta', 二車単: 'exacta', '2車複': 'quinella', 二車複: 'quinella', ワイド: 'wide' }[h[0]];
    const tm = row.match(/(\d{1,2})[:時](\d{2})\s*分?\s*(?:時点|現在)?/);
    if (tm && /時点|現在|オッズ|取得|更新/.test(row)) at = `${tm[1].padStart(2, '0')}:${tm[2]}`;
    // 「1-2-3 12.5」「1=2=3 4.8倍」「1-2: 3.4」。ワイドは「1=2 1.5-2.0」のように幅があれば小さいほう
    for (const m of row.matchAll(/(?:^|[^\d.])([1-9])\s*([-=])\s*([1-9])(?:\s*([-=])\s*([1-9]))?\s*[:：]?\s*(\d{1,5}(?:\.\d)?)\s*(?:倍|-\s*\d|$|[^\d.])/g)) {
      const nums = [m[1], m[3], m[5]].filter(Boolean).map(Number);
      if (new Set(nums).size !== nums.length) continue;
      if (carSet.size && nums.some(c => !carSet.has(c))) continue;
      const odds = Number(m[6]);
      if (!(odds >= 1)) continue;
      const ordered = m[2] === '-' && (!m[4] || m[4] === '-');
      let type = section;
      const fits = t => (t === 'trifecta' || t === 'trio') === (nums.length === 3);
      if (!type || !fits(type)) type = nums.length === 3 ? (ordered ? 'trifecta' : 'trio') : (ordered ? 'exacta' : 'quinella');
      const key = type === 'trifecta' || type === 'exacta' ? nums.join('-') : sortKey(nums);
      out[type][key] = odds;
    }
  }
  const count = Object.values(out).reduce((s, o) => s + Object.keys(o).length, 0);
  return { odds: out, count, at };
}

// 組み合わせの総数
const nComb = (type, n) => ({ trifecta: n * (n - 1) * (n - 2), trio: n * (n - 1) * (n - 2) / 6, exacta: n * (n - 1), quinella: n * (n - 1) / 2, wide: n * (n - 1) / 2 }[type]);

// 本物らしいかの点検。全組み合わせがそろっていれば 1/オッズ の合計 (払戻率75%なら約1.33) を確かめる
export function checkOdds(odds, n) {
  const notes = [], warn = [];
  for (const [type, o] of Object.entries(odds)) {
    const keys = Object.keys(o);
    if (!keys.length) continue;
    const total = nComb(type, n);
    const inv = keys.reduce((s, k) => s + 1 / o[k], 0);
    if (type === 'wide') { notes.push(`${ODDS_TYPES[type]} ${keys.length}通り`); continue; }
    if (keys.length >= total) {
      const ok = inv > 1.15 && inv < 1.6;
      (ok ? notes : warn).push(`${ODDS_TYPES[type]} 全${total}通り: 1/オッズの合計 ${inv.toFixed(2)} (本物なら1.3前後)${ok ? '' : ' … 本物のオッズとしてはおかしい数字です'}`);
    } else {
      notes.push(`${ODDS_TYPES[type]} ${keys.length}/${total}通り`);
      if (inv > 1.45) warn.push(`${ODDS_TYPES[type]}: 一部だけなのに 1/オッズの合計が ${inv.toFixed(2)} あり、本物のオッズとしてはおかしい数字です`);
    }
  }
  return { ok: !warn.length, notes, warn };
}

// みんなの見立て: 1着の確率 (2車単か3連単の全組み合わせから。足りなければ、ある分からの目安)
export function marketWin(odds, cars) {
  const n = cars.length;
  const from = type => {
    const o = odds[type]; const keys = Object.keys(o ?? {});
    if (!keys.length) return null;
    const full = keys.length >= nComb(type, n);
    const w = Object.fromEntries(cars.map(c => [c, 0]));
    let sum = 0;
    for (const k of keys) { const p = 1 / o[k]; w[Number(k.split('-')[0])] += p; sum += p; }
    const norm = full ? sum : 1 / PAYOUT; // 一部だけなら、払戻率から割り戻す
    for (const c of cars) w[c] /= norm;
    return { win: w, full, from: ODDS_TYPES[type] };
  };
  const ex = from('exacta'), tri = from('trifecta');
  return (ex?.full ? ex : tri?.full ? tri : ex ?? tri) ?? null;
}

// みんなの見立て: 3連単の確率。3連単のオッズがあればそれ、無ければ2車単から推定 (3着は残りの選手の強さで割り振る)
export function marketTrifecta(odds, cars) {
  const o = odds.trifecta ?? {}, keys = Object.keys(o);
  const full = keys.length >= nComb('trifecta', cars.length);
  const sum = full ? keys.reduce((s, k) => s + 1 / o[k], 0) : 1 / PAYOUT;
  const p = {};
  for (const k of keys) p[k] = { p: (1 / o[k]) / sum, odds: o[k], est: false };
  const mw = marketWin(odds, cars);
  const ex = odds.exacta ?? {};
  if (mw && Object.keys(ex).length) {
    const exSum = Object.keys(ex).length >= nComb('exacta', cars.length) ? Object.keys(ex).reduce((s, k) => s + 1 / ex[k], 0) : 1 / PAYOUT;
    for (const a of cars) for (const b of cars) {
      if (a === b || !ex[`${a}-${b}`]) continue;
      const rest = cars.filter(c => c !== a && c !== b);
      const rw = rest.reduce((s, c) => s + mw.win[c], 0) || 1;
      for (const c of rest) {
        const k = `${a}-${b}-${c}`;
        if (p[k]) continue;
        const q = (1 / ex[`${a}-${b}`]) / exSum * (mw.win[c] / rw);
        p[k] = { p: q, odds: Math.max(1, Math.round(PAYOUT / q * 10) / 10), est: true };
      }
    }
  }
  return p;
}

// AIの見立てとみんなの見立てのズレ (1着)
export function gaps(aiWin, mWin, cars) {
  return cars.map(c => {
    const ai = aiWin[c] ?? 0, m = mWin?.[c] ?? 0;
    const r = ai / Math.max(m, 0.005);
    const tag = ai >= 0.08 && r >= 1.4 ? { id: 'value', label: '狙い目', note: 'AIの方が高く見ている' }
      : m >= 0.12 && r <= 1 / 1.4 ? { id: 'over', label: '人気しすぎ', note: 'みんなの方が高く見ている' }
      : { id: 'even', label: '', note: '' };
    return { car: c, ai, market: m, ratio: r, tag };
  }).sort((a, b) => b.market - a.market);
}

// 3連単を倍率で 本命・中穴・穴 に分け、それぞれAIの確率が高い順に
//   aiTable: [{ key, p }] (AIの3連単の確率) / mTri: marketTrifecta の結果 (無ければAIの確率から出した目安の倍率で分ける)
export function trifectaTiers(aiTable, mTri = null, per = 3) {
  const rows = aiTable.map(x => {
    const m = mTri?.[x.key];
    const odds = m ? m.odds : Math.round(PAYOUT / Math.max(x.p, 1e-5) * 10) / 10;
    return { key: x.key, p: x.p, odds, est: m ? m.est : true, fromAi: !m, mp: m?.p ?? null };
  });
  return TIERS.map(t => {
    const list = rows.filter(r => r.odds >= t.min && r.odds < t.max).sort((a, b) => b.p - a.p).slice(0, per);
    return { ...t, list, hit: list.reduce((s, r) => s + r.p, 0) };
  });
}

// チャッピーなどに頼むときの文
export const ODDS_PROMPT = `このレースの最新オッズを、公式サイトか投票サイトで確認して、次の形で書いてください。
1行目に「◯時◯分時点」
2車単 (全通り) … 1-2 3.4 の形で1行に1つ
3連単 (人気順に上から50通り) … 1-2-3 12.5 の形で1行に1つ
・数字を作らないでください。確認できなかったときは「確認できなかった」と書いてください`;
