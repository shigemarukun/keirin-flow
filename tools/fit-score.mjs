// KEIRIN FLOW — 検証台の結果が、実データからどれだけ離れているかを1つの数にする (小さいほど良い)
//   JSON=1 node tools/bench.mjs | node tools/fit-score.mjs
// 実データ: 1着・2着の決まり手 (netkeiba 全レース 2021-2026)、ライン位置別 (男子7車)、バンク別 (333/400/500)
let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => {
  const r = JSON.parse(s), terms = [];
  const add = (name, sim, real, w = 1) => terms.push({ name, sim, real, err: w * (sim - real) ** 2 });
  const k = r.seven.kimarite; add('1着逃げ', k.逃げ, 23.5); add('1着捲り', k.捲り, 31.3); add('1着差し', k.差し, 44.9);
  const p = r.seven.positions; add('先頭1着', p.先頭.win, 21.6, 2); add('番手1着', p.番手.win, 14.9, 2); add('3番手1着', p['3番手'].win, 2.6, 2); add('単騎1着', p.単騎.win, 6.8, 2);
  add('先頭3着内', p.先頭.top3, 49.2); add('番手3着内', p.番手.top3, 46.9); add('3番手3着内', p['3番手'].top3, 32.5); add('単騎3着内', p.単騎.top3, 25.7);
  const s2 = r.seven.second; add('2着逃げ', s2.逃げ, 19.8); add('2着捲り', s2.捲り, 16.2); add('2着差し', s2.差し, 23.7); add('2着マーク', s2.マーク, 40.0);
  const b = r.bank, BR = { 333: [33, 31, 36], 400: [25, 30, 45], 500: [24, 26, 50] };
  for (const [bk, [e, m, sa]] of Object.entries(BR)) if (b[bk]) { add(`${bk}逃げ`, b[bk].逃げ, e, .5); add(`${bk}捲り`, b[bk].捲り, m, .5); add(`${bk}差し`, b[bk].差し, sa, .5); }
  const total = terms.reduce((a, t) => a + t.err, 0);
  console.log(`ずれ ${Math.sqrt(total / terms.length).toFixed(2)} (平均のずれ・%ポイント)  大きい順: ${terms.sort((a, b) => b.err - a.err).slice(0, 5).map(t => `${t.name} ${t.sim}→${t.real}`).join(', ')}`);
});
