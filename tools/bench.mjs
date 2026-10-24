// KEIRIN FLOW — 検証台: いろいろな出走表で何千レースも走らせ、実データと比べる
//
//   node tools/bench.mjs                 # 3000レース (並列)
//   N=600 node tools/bench.mjs           # レース数を変える
//   KF_TUNE='{"draft":0.5}' node tools/bench.mjs   # 調整値を試す
//   JSON=1 node tools/bench.mjs > out.json         # 数字だけ出す (比較用)
//
// 出走表は固定のシードから作るので、同じ設定なら毎回同じ結果になる (変更の前後を同じ条件で比べられる)。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';

const ROOT = new URL('../', import.meta.url);

// ---------- 出走表をつくる ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = rnd => { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (rnd, pairs) => { let x = rnd() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[0][0]; };
const LAYOUT7 = [[3, 2, 2], [3, 3, 1], [2, 2, 2, 1], [3, 2, 1, 1], [4, 3], [2, 2, 3], [3, 2, 2]];
const LAYOUT9 = [[3, 3, 3], [3, 2, 2, 2], [4, 3, 2], [3, 3, 2, 1], [2, 2, 2, 3]];

export function makeRace(i, opts = {}) {
  const rnd = mulberry32(9001 + i * 7919);
  const cars = opts.cars ?? (rnd() < 0.8 ? 7 : 9);
  const family = opts.family ?? (rnd() < 0.7 ? 'S' : 'A');
  const sizes = [...pick(rnd, cars === 7 ? LAYOUT7 : LAYOUT9)].sort(() => rnd() - 0.5);
  const nums = Array.from({ length: cars }, (_, k) => k + 1).sort(() => rnd() - 0.5);
  const lines = []; let at = 0;
  for (const n of sizes) { lines.push(nums.slice(at, at + n)); at += n; }
  const riders = [];
  for (const line of lines) line.forEach((car, pos) => {
    const solo = line.length === 1;
    const style = solo ? weighted(rnd, [['両', 2], ['逃', 1], ['追', 1]]) : pos === 0 ? (rnd() < 0.55 ? '逃' : '両') : (rnd() < 0.75 ? '追' : '両');
    const score = family === 'S' ? Math.min(120, Math.max(95, 106 + gauss(rnd) * 5)) : Math.min(99, Math.max(80, 88 + gauss(rnd) * 4));
    const cls = family === 'S' ? (score >= 112 && rnd() < 0.3 ? 'SS' : score >= 106 ? 'S1' : 'S2') : (score >= 88 ? 'A1' : 'A2');
    const back = style === '逃' ? 6 + Math.floor(rnd() * 15) : style === '両' ? 2 + Math.floor(rnd() * 8) : Math.floor(rnd() * 3);
    const start = pos === 0 ? Math.floor(rnd() * 10) : Math.floor(rnd() * 3);
    riders.push({ car, score: +score.toFixed(2), class: cls, style, back, start });
  });
  const venue = opts.venue ?? weighted(rnd, [['小倉', 70], ['松戸', 15], ['大宮', 15]]);
  return { race: { venue, grade: family }, riders: riders.sort((a, b) => a.car - b.car), lines, autoFormation: rnd() < 0.5, _cars: cars, _family: family };
}

// ---------- 1レースを走らせて、数える ----------
async function runOne(i, opts) {
  const { toRaceSetup } = await import(new URL('race-data.js', ROOT));
  const { withCondition } = await import(new URL('forecast.js', ROOT));
  const { PhysicsEngine } = await import(new URL('engine.js', ROOT));
  const data = makeRace(i, opts);
  const setup = withCondition(toRaceSetup(data), 5000 + i).setup;
  const e = new PhysicsEngine(setup);
  e.start();
  const t0 = Date.now();
  for (let t = 0; t < 160 && !e.riders.every(r => r.finished); t += 1 / 120) e._step(1 / 120);
  e._finalizeRanking();
  const ms = Date.now() - t0;
  const order = e.ranking.map(r => r.number);
  const story = e.getStory();
  const logs = e.decisionLogs;
  const by = (re) => [...new Set(logs.filter(l => re.test(l.message)).map(l => l.riderNumber))];
  const roleOf = n => { const r = e.rider(n); return r.role === 'SOLO' ? '単騎' : r.linePosition === 0 ? '先頭' : r.linePosition === 1 ? '番手' : '3番手'; };
  const lineOf = n => setup.lines.find(l => l.members.includes(n))?.id ?? `S${n}`;
  const makuri = by(/捲りに出る/), kamashi = by(/カマす/), chigire = by(/千切れ/), banteMakuri = by(/番手捲り/), inner = by(/内を突く/), naka = by(/中を割って/);
  return {
    i, cars: data._cars, family: data._family, bank: setup.trackProfile.replace('PROFILE_', ''), ms,
    how: story.kimarite?.how ?? '不明', mark2: !!story.kimarite?.marks?.includes(order[1]),
    roles: e.riders.map(r => ({ role: roleOf(r.number), fin: order.indexOf(r.number) + 1, power: r.profile.power })),
    winnerRole: roleOf(order[0]),
    line12: lineOf(order[0]) === lineOf(order[1]), line123: lineOf(order[0]) === lineOf(order[1]) && lineOf(order[1]) === lineOf(order[2]),
    backLeaderFin: order.indexOf(e.recorder.snapshots.back?.order?.[0]) + 1,
    makuriTry: makuri.length, makuriWin: makuri.includes(order[0]) ? 1 : 0,
    kamashiTry: kamashi.length, kamashiTop3: kamashi.filter(n => order.slice(0, 3).includes(n)).length,
    chigire: chigire.map(roleOf), banteMakuri: banteMakuri.length, inner: inner.length, naka: naka.length,
    tsuppari: logs.some(l => /突っ張る/.test(l.message)), hiku: logs.some(l => /後方へ引く/.test(l.message)), chudan: logs.some(l => /中団を取る/.test(l.message))
  };
}

// ---------- 集計 ----------
export function summarize(rs) {
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const group = (f) => { const m = {}; for (const r of rs) { const k = f(r); (m[k] ??= []).push(r); } return m; };
  const kim = list => { const c = { 逃げ: 0, 捲り: 0, 差し: 0 }; for (const r of list) if (c[r.how] != null) c[r.how]++; return { 逃げ: pct(c.逃げ, list.length), 捲り: pct(c.捲り, list.length), 差し: pct(c.差し, list.length), n: list.length }; };
  const pos = list => { const m = {}; for (const r of list) for (const x of r.roles) { const s = (m[x.role] ??= { n: 0, w: 0, t3: 0 }); s.n++; if (x.fin === 1) s.w++; if (x.fin <= 3) s.t3++; } return Object.fromEntries(Object.entries(m).map(([k, s]) => [k, { win: pct(s.w, s.n), top3: pct(s.t3, s.n), n: s.n }])); };
  const seven = rs.filter(r => r.cars === 7);
  const chig = {}; for (const r of rs) for (const role of r.chigire) chig[role] = (chig[role] ?? 0) + 1;
  const roleCount = {}; for (const r of rs) for (const x of r.roles) roleCount[x.role] = (roleCount[x.role] ?? 0) + 1;
  return {
    n: rs.length, msPerRace: Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length),
    seven: { kimarite: kim(seven), positions: pos(seven), mark2: pct(seven.filter(r => r.mark2).length, seven.length),
      line12: pct(seven.filter(r => r.line12).length, seven.length), line123: pct(seven.filter(r => r.line123).length, seven.length) },
    bank: Object.fromEntries(Object.entries(group(r => r.bank)).map(([k, l]) => [k, kim(l)])),
    family: Object.fromEntries(Object.entries(group(r => r.family)).map(([k, l]) => [k, kim(l)])),
    nine: kim(rs.filter(r => r.cars === 9)),
    backLeader: { win: pct(rs.filter(r => r.backLeaderFin === 1).length, rs.length), top3: pct(rs.filter(r => r.backLeaderFin <= 3 && r.backLeaderFin > 0).length, rs.length) },
    makuri: { tryPerRace: Math.round(rs.reduce((s, r) => s + r.makuriTry, 0) / rs.length * 100) / 100, winOfTries: pct(rs.reduce((s, r) => s + r.makuriWin, 0), rs.reduce((s, r) => s + r.makuriTry, 0)) },
    kamashi: { tryPerRace: Math.round(rs.reduce((s, r) => s + r.kamashiTry, 0) / rs.length * 100) / 100, top3OfTries: pct(rs.reduce((s, r) => s + r.kamashiTop3, 0), rs.reduce((s, r) => s + r.kamashiTry, 0)) },
    chigire: Object.fromEntries(Object.entries(chig).map(([k, v]) => [k, pct(v, roleCount[k])])),
    events: { 番手捲り: pct(rs.filter(r => r.banteMakuri).length, rs.length), 内すくい: pct(rs.filter(r => r.inner).length, rs.length), 中割り: pct(rs.filter(r => r.naka).length, rs.length),
      突っ張り: pct(rs.filter(r => r.tsuppari).length, rs.length), 引く: pct(rs.filter(r => r.hiku).length, rs.length), 中団: pct(rs.filter(r => r.chudan).length, rs.length) }
  };
}

const TARGET = {
  seven: '逃げ19〜21 / 捲り28 / 差し50〜53 (7車F1・F2)',
  pos: { 先頭: '21.6/49.2', 番手: '14.9/46.9', '3番手': '2.6/32.5', 単騎: '6.8/25.7' },
  mark2: '40.6 (S級) / 38.6 (A級)',
  bank: { 333: '33/31/36', 400: '25/30/45', 500: '24/26/50' }
};
function printReport(r) {
  const k = x => `逃げ${x.逃げ}% 捲り${x.捲り}% 差し${x.差し}% (n=${x.n})`;
  console.log(`=== KEIRIN FLOW 検証台: ${r.n}レース (${r.seconds}秒、1レース${r.msPerRace}ms) ===`);
  console.log(`[7車立て] 決まり手 ${k(r.seven.kimarite)}   実際: ${TARGET.seven}`);
  for (const [role, s] of Object.entries(r.seven.positions)) console.log(`  ${role.padEnd(4, '　')} 1着${s.win}% 3着内${s.top3}%   実際 ${TARGET.pos[role] ?? '-'}  (n=${s.n})`);
  console.log(`  2着がマーク ${r.seven.mark2}% (実際 ${TARGET.mark2}) / 同じラインでワンツー ${r.seven.line12}% / 3着まで独占 ${r.seven.line123}%`);
  console.log(`[9車立て] ${k(r.nine)}`);
  for (const [b, x] of Object.entries(r.bank)) console.log(`[${b}バンク] ${k(x)}   実際: ${TARGET.bank[b] ?? '-'}`);
  for (const [f, x] of Object.entries(r.family)) console.log(`[${f}級] ${k(x)}`);
  console.log(`[バック先頭] 1着${r.backLeader.win}% 3着内${r.backLeader.top3}%`);
  console.log(`[捲り] 1レースあたり${r.makuri.tryPerRace}人が仕掛け、そのうち1着${r.makuri.winOfTries}%`);
  console.log(`[カマシ] 1レースあたり${r.kamashi.tryPerRace}人、そのうち3着内${r.kamashi.top3OfTries}%`);
  console.log(`[千切れ] 役割ごとの割合 ${JSON.stringify(r.chigire)}`);
  console.log(`[起きた割合] ${Object.entries(r.events).map(([a, b]) => `${a}${b}%`).join(' ')}`);
}

// ---------- 実行 (定義がそろってから) ----------
async function main() {
if (!isMainThread) {
  const out = [];
  for (const i of workerData.ids) out.push(await runOne(i, workerData.opts));
  parentPort.postMessage(out);
} else {
  const N = Number(process.env.N ?? 3000);
  const opts = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
  const W = Math.max(1, Math.min(Number(process.env.W ?? cpus().length), 8));
  const ids = Array.from({ length: N }, (_, i) => i);
  const chunks = Array.from({ length: W }, (_, w) => ids.filter(i => i % W === w));
  const t0 = Date.now();
  const results = (await Promise.all(chunks.map(c => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { ids: c, opts }, env: process.env });
    wk.on('message', res); wk.on('error', rej);
  })))).flat().sort((a, b) => a.i - b.i);
  const report = summarize(results);
  report.seconds = Math.round((Date.now() - t0) / 1000);
  if (process.env.JSON) console.log(JSON.stringify(report));
  else printReport(report);
}
}
await main();
