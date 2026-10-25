// KEIRIN FLOW — 過去のレースでまとめて答え合わせ
//
// 出走表と結果 (と、書いていれば自分の展開) を何レース分もまとめて貼ると、
// 1レースずつAIに予想させて、実際の着順にどれだけの確率を付けていたかを採点する。
//
// 1レースの書き方 (どれも出走表の貼り付けと同じ形でOK):
//   (出走表の文字 … 車番・名前・級班・得点・脚質・並び)
//   展開: 佐藤が打鐘でカマす。長尾がバックで番手捲り      ← 書かなくてもよい
//   結果: 3-1-7                                          ← 1着-2着-3着
// レースとレースの間は「---」の行で区切る。区切りが無ければ「結果」の行でレースが終わったとみなす。
import { parseRaceCardText, validateRaceData, toRaceSetup, bankOfVenue } from './race-data.js';
import { parseTenkaiText, applyTenkai } from './tenkai-text.js';
import { makeLock, scoreLock } from './scoring.js';
import { buildAdvice } from './advice.js';
import { normalizeRaceSetup } from './race-plan.js';

// 画面の予想と同じ形 (エンジンが整えたレース設定) にして、作業スレッドへ渡せるよう素のデータにする
export const setupOf = data => JSON.parse(JSON.stringify(normalizeRaceSetup(toRaceSetup(data))));

const half = s => String(s ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[－ー―→＞>]/g, '-');
const RESULT_RE = /^[ \t]*[【\[(（]?(?:結果|着順|確定|決着|3連単|三連単|払戻|払い戻し)[】\])）]?[^\d\n]{0,8}([1-9])[ \t]*[-=,、・ \t][ \t]*([1-9])[ \t]*[-=,、・ \t][ \t]*([1-9])/;
const TENKAI_RE = /^[ \t]*[【\[(（]?(?:展開|自分の展開|自分の読み|読み|予想展開)[】\])）]?[ \t]*[:：]?[ \t]*(.*)$/;
const SEP_RE = /^[ \t]*(?:-{3,}|ー{3,}|={3,}|＝{3,}|━{3,}|─{3,}|\*{3,})[ \t]*$/;

// 貼られた文字を、レースごとに分ける
export function splitBatchText(text) {
  const rows = String(text ?? '').replace(/\r/g, '').split('\n');
  const useSep = rows.some(r => SEP_RE.test(half(r)));
  const blocks = [];
  let cur = { card: [], tenkai: [], actual: null, first: null };
  const close = () => {
    if (cur.card.some(r => r.trim()) || cur.actual) blocks.push(cur);
    cur = { card: [], tenkai: [], actual: null, first: null };
  };
  rows.forEach((raw, i) => {
    const r = half(raw);
    if (SEP_RE.test(r)) { close(); return; }
    const res = r.match(RESULT_RE);
    if (res) {
      const a = [Number(res[1]), Number(res[2]), Number(res[3])];
      if (!cur.actual) cur.actual = a;
      if (!useSep) close();
      return;
    }
    const tk = raw.match(TENKAI_RE);
    if (tk && !/^[ \t]*[1-9]/.test(raw)) { if (tk[1].trim()) cur.tenkai.push(tk[1].trim()); return; }
    if (cur.first == null && r.trim()) cur.first = i + 1;
    cur.card.push(raw);
  });
  close();
  // 結果の無い短い切れ端 (説明の文など) は、レースとして数えない
  return blocks.filter(b => b.actual || b.card.filter(r => r.trim()).length >= 3).map(b => ({ cardText: b.card.join('\n').trim(), tenkaiText: b.tenkai.join('。'), actual: b.actual, row: b.first }));
}

// 1レース分を、予想できる形にする (出走表の貼り付けと同じ読み取り)
export function prepareRace(block) {
  const label = () => [data?.race?.venue, data?.race?.raceNo ? `${data.race.raceNo}R` : ''].filter(Boolean).join(' ') || `${block.row ?? '?'}行目からのレース`;
  let data = null;
  if (!block.cardText) return { ok: false, label: '(出走表なし)', error: '出走表がありません' };
  const parsed = parseRaceCardText(block.cardText);
  if (!parsed.found?.riders) return { ok: false, label: label(), error: '出走表を読み取れませんでした' };
  data = { ...parsed.data, lines: parsed.data.lines ?? [] };
  data.race = { ...(data.race ?? {}) };
  if (data.race.grade === 'L') data.race.girls = true;
  data.bank = data.bank ?? bankOfVenue(data.race.venue) ?? undefined;
  if (!block.actual) return { ok: false, label: label(), error: '結果 (例: 結果 3-1-7) が見つかりません' };
  const cars = data.riders.map(r => Number(r.car));
  const bad = block.actual.filter(c => !cars.includes(c));
  if (bad.length || new Set(block.actual).size < 3) return { ok: false, label: label(), error: `結果 ${block.actual.join('-')} が出走表の車番と合いません` };
  const errors = validateRaceData(data);
  if (errors.length) return { ok: false, label: label(), error: errors[0] };
  const out = { ok: true, label: label(), actual: block.actual, aiData: data, aiSetup: setupOf(data), tenkaiText: block.tenkaiText || '', warnings: parsed.warnings ?? [] };
  if (block.tenkaiText) {
    const t = parseTenkaiText(block.tenkaiText, data);
    if (t.readings.length) {
      const mine = applyTenkai(data, t.changes);
      if (!validateRaceData(mine).length) { out.mineSetup = setupOf(mine); out.readings = t.readings.map(r => r.text); }
    }
    if (!out.mineSetup) out.warnings = [...out.warnings, '展開の文章から指定を読み取れなかったので、AIの予想だけで採点します'];
  }
  return out;
}

// 予想 (forecastRaces の結果) を採点する
export function scoreForecast(setup, forecast, actual) {
  const sc = forecast.scenarios?.[0];
  const advice = sc ? buildAdvice({ runs: forecast.runs, scenario: sc, marks: forecast.marks, names: setup?.meta?.names ?? {} }) : null;
  const lock = makeLock({ setup, forecast, advice });
  const s = scoreLock(lock, actual);
  return { main: lock.main, p: s.p, rank: s.rank, combos: s.combos, vsRandom: s.vsRandom, logLoss: s.logLoss, logLossRandom: s.logLossRandom, winP: s.winP, winHit: s.winHit, exactaHit: s.exactaHit, trifectaHit: s.trifectaHit, adviceHit: s.adviceHit, advicePoints: s.advicePoints };
}

// まとめの数字 (確率の当たり具合は掛け算の平均)
export function summarizeBatch(rows) {
  const done = rows.filter(r => r.ai);
  if (!done.length) return null;
  const n = done.length;
  const geo = list => Math.exp(list.reduce((s, x) => s + Math.log(Math.max(x, 1e-4)), 0) / list.length);
  const avg = f => done.reduce((s, r) => s + f(r), 0) / n;
  const withAdv = done.filter(r => r.ai.adviceHit != null);
  const both = done.filter(r => r.mine);
  return {
    n,
    vsRandom: geo(done.map(r => r.ai.vsRandom)),
    winHit: avg(r => r.ai.winHit ? 1 : 0),
    exactaHit: avg(r => r.ai.exactaHit ? 1 : 0),
    trifectaHit: avg(r => r.ai.trifectaHit ? 1 : 0),
    adviceHit: withAdv.length ? withAdv.filter(r => r.ai.adviceHit).length / withAdv.length : null,
    advicePoints: withAdv.length ? withAdv.reduce((s, r) => s + (r.ai.advicePoints ?? 0), 0) / withAdv.length : null,
    mine: both.length ? {
      n: both.length,
      vsRandomMine: geo(both.map(r => r.mine.vsRandom)),
      vsRandomAi: geo(both.map(r => r.ai.vsRandom)),
      better: both.filter(r => r.mine.p > r.ai.p * 1.5).length,
      worse: both.filter(r => r.mine.p < r.ai.p / 1.5).length,
      trifectaMine: both.filter(r => r.mine.trifectaHit).length
    } : null
  };
}

// 自分の読みが、AIだけの予想と比べてどうだったか (1レース分の短い言葉)
export function compareText(mine, ai) {
  if (!mine || !ai) return '';
  const r = mine.p / Math.max(ai.p, 1e-4);
  if (r >= 1.5) return `あなたの読みで、実際の決着の確率が ${r.toFixed(1)}倍 に上がった`;
  if (r <= 1 / 1.5) return `あなたの読みで、実際の決着の確率が ${(1 / r).toFixed(1)}分の1 に下がった`;
  return 'あなたの読みを入れても、実際の決着の確率は大きくは変わらなかった';
}

// あなたが付け加えた読み (戦法・前受けの対応・文章の展開) を抜いた、AIだけの出走表
export function stripUserReads(data) {
  if (!data) return null;
  const has = o => o && Object.keys(o).length;
  if (!has(data.tactics) && !has(data.frontResponse) && !has(data.tenkai) && !data.tenkaiText) return null;
  const d = structuredClone(data);
  d.tactics = {}; d.frontResponse = {}; d.tenkai = {}; delete d.tenkaiText;
  return d;
}
