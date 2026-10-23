// KEIRIN FLOW — レースデータ(出走表)の共通形式と、能力値への変換
//
// どの入口(手入力・スクショ・URL)から来ても、最後はこの「レースデータ」に揃える。
// シミュレーションはレースデータを toRaceSetup() で変換したものだけを使う。
//
// レースデータの形:
// {
//   race:   { venue: '小倉', date: '2026-10-24', raceNo: 11, name: 'S級決勝' },
//   riders: [
//     { car: 1, name: '山田 太郎', class: 'S1', score: 112.5, style: '逃',
//       back: 12, start: 3, gear: 3.92, comment: '自力' },
//     ...
//   ],
//   lines:  [[1, 2, 3], [4, 5, 6], [7, 8, 9]],   // 並び (周回の前から順に)。単騎は [8] のように1人で書く
//   autoFormation: false                          // true ならAIが周回の並び順を決める
// }
//
// 変換ルール v0 (すべて仮の数字。実際のレース結果と比べて調整していく前提)
//   競走得点 score  → 地力 power      : 100点=0.70、120点=0.95 の直線
//   脚質 style      → 戦法の傾向       : 逃=先行寄り / 両=捲り寄り / 追=番手・マーク寄り
//   バック回数 back → 先行意欲 aggression
//   S回数 start     → 前受け・位置取りの強さ (隊列をAIに任せたときに使う)
//   ギヤ倍数・年齢・級班 → v0 では使わない (効くかどうか後で検証する)

export const STYLE = Object.freeze({ NIGE: '逃', RYO: '両', OI: '追' });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = v => Math.round(v * 100) / 100;
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : fallback);

export const CONVERSION_RULES_VERSION = 'v0';

// 「展開を選ぶ」で指定できる戦法 (ライン先頭・単騎の選手に付ける)
//   data.tactics       = { 1: 'SENKO', 4: 'MAKURI' }   先行 / カマシ / 捲り / 追込
//                        { 8: 'SERI:1' }                単騎の8番が、1番のラインの番手を競る
//   data.frontResponse = { 1: 'TSUPPARI' }            前受けの選手が 突っ張る / 出させる
export const TACTIC_CODES = Object.freeze(['SENKO', 'KAMASHI', 'MAKURI', 'OIKOMI']);

// ---------- 入力のチェックと正規化 ----------
export function validateRaceData(data) {
  const errors = [];
  const riders = Array.isArray(data?.riders) ? data.riders : [];
  const cars = riders.map(r => Number(r.car));
  if (riders.length < 2 || riders.length > 9) errors.push('選手は2〜9人で入力してください');
  const dup = cars.filter((c, i) => cars.indexOf(c) !== i);
  if (dup.length) errors.push(`車番 ${[...new Set(dup)].join(', ')} が重複しています`);
  if (cars.some(c => !Number.isInteger(c) || c < 1 || c > 9)) errors.push('車番は1〜9の数字で入力してください');
  for (const r of riders) {
    if (r.style && !Object.values(STYLE).includes(r.style)) errors.push(`${r.car}番の脚質「${r.style}」は 逃/両/追 のどれかにしてください`);
    if (r.score !== undefined && r.score !== '' && !Number.isFinite(Number(r.score))) errors.push(`${r.car}番の競走得点が数字ではありません`);
  }
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const inLines = lines.flat().map(Number);
  const missing = cars.filter(c => !inLines.includes(c));
  const unknown = inLines.filter(c => !cars.includes(c));
  const twice = inLines.filter((c, i) => inLines.indexOf(c) !== i);
  if (!lines.length) errors.push('並び(ライン)を入力してください');
  if (missing.length) errors.push(`並びに入っていない選手がいます: ${missing.join(', ')}番`);
  if (unknown.length) errors.push(`並びに出走しない車番があります: ${unknown.join(', ')}番`);
  if (twice.length) errors.push(`並びで ${[...new Set(twice)].join(', ')}番 が2回出てきます`);
  for (const [car, t] of Object.entries(data?.tactics ?? {})) {
    if (!t) continue;
    const seri = /^SERI:([1-9])$/.exec(t);
    if (seri) {
      const target = Number(seri[1]), lineOfTarget = lines.find(l => l.map(Number)[0] === target);
      const own = lines.find(l => l.map(Number).includes(Number(car)));
      if (!lineOfTarget || lineOfTarget.length < 2) errors.push(`${car}番が競る相手のライン(${target}番が先頭)が見つかりません`);
      else if (own && own.length > 1) errors.push(`番手を競れるのは単騎の選手だけです (${car}番)`);
      continue;
    }
    if (!TACTIC_CODES.includes(t)) errors.push(`${car}番の戦法「${t}」は指定できません`);
  }
  for (const [car, f] of Object.entries(data?.frontResponse ?? {})) if (f && !['TSUPPARI', 'YIELD'].includes(f)) errors.push(`${car}番の前受けの対応「${f}」は指定できません`);
  return errors;
}

// "123/456/789" や "1-2-3 4-5-6 7" のような並びの書き方を [[1,2,3],[4,5,6],[7]] にする
export function parseLines(text) {
  return String(text ?? '')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .split(/[\/／|｜、,\s　]+/)
    .map(group => [...group.replace(/[^1-9]/g, '')].map(Number))
    .filter(group => group.length);
}

export function formatLines(lines) {
  return (lines ?? []).map(group => group.join('')).join(' / ');
}

// ---------- 1人分の変換 ----------
export function riderToProfile(r) {
  const score = num(r.score, 105);
  const style = Object.values(STYLE).includes(r.style) ? r.style : STYLE.RYO;
  const back = clamp(num(r.back, style === STYLE.NIGE ? 8 : style === STYLE.RYO ? 4 : 1), 0, 30);
  const power = clamp(0.70 + (score - 100) * 0.0125, 0.45, 1.0);
  const backBoost = clamp(back / 20, 0, 1) * 0.10;

  const base = {
    [STYLE.NIGE]: { aggression: 0.80, accel: -0.02, endur: +0.03, iq: 0.78, block: 0.70 },
    [STYLE.RYO]:  { aggression: 0.68, accel: +0.03, endur: 0.00, iq: 0.82, block: 0.78 },
    [STYLE.OI]:   { aggression: 0.48, accel: 0.00, endur: 0.00, iq: 0.84, block: 0.88 }
  }[style];

  const profile = {
    power: round2(power),
    acceleration: round2(clamp(power + base.accel, 0.4, 1)),
    endurance: round2(clamp(power + base.endur, 0.4, 1)),
    tacticalIQ: round2(base.iq),
    aggression: round2(clamp(base.aggression + backBoost, 0.2, 1)),
    riskTolerance: style === STYLE.NIGE ? 0.62 : 0.55,
    blockSkill: round2(base.block)
  };

  const why = [
    `競走得点${score}${r.score === undefined || r.score === '' ? '(未入力のため仮)' : ''} → 地力${profile.power}`,
    `脚質「${style}」${r.style ? '' : '(未入力のため両で仮置き)'}`,
    `B${back}回 → 先行意欲${profile.aggression}`
  ];
  return { profile, style, back, start: num(r.start, 0), why };
}

// 先頭に立つ選手の「前受け時の対応」: 逃でバックが多い=突っ張り、それ以外=出させる
function mindsetFor(info) {
  if (info.style === STYLE.NIGE) return info.back >= 5 ? 'TSUPPARI' : 'CONTAIN';
  return 'YIELD_AND_ROLL';
}

// ---------- 隊列(周回の並び順)をAIが決める ----------
// 前受け: 先頭のS回数が一番多いライン (同点なら先行意欲が低いほうが前)
// 最後方: 先行意欲が一番高い(=赤板で誘導切りに来る)ライン
export function orderLinesAuto(lines, infoByCar) {
  if (lines.length <= 2) return lines.map(l => [...l]);
  const lead = l => infoByCar[l[0]];
  const rest = lines.map(l => [...l]);
  rest.sort((a, b) => (lead(b).start - lead(a).start) || (lead(a).profile.aggression - lead(b).profile.aggression) || (a[0] - b[0]));
  const front = rest.shift();
  rest.sort((a, b) => (lead(a).profile.aggression - lead(b).profile.aggression) || (a[0] - b[0]));
  return [front, ...rest];
}

// ---------- レースデータ → シミュレーション設定 ----------
export function toRaceSetup(data) {
  const errors = validateRaceData(data);
  if (errors.length) throw new Error(errors.join('\n'));

  const infoByCar = {};
  for (const r of data.riders) infoByCar[Number(r.car)] = { ...riderToProfile(r), name: r.name ?? '' };

  let lines = data.lines.map(l => l.map(Number));
  if (data.autoFormation) lines = orderLinesAuto(lines, infoByCar);
  // 番手を競る単騎は、競る相手のラインのすぐ後ろからスタートする
  for (const [car, t] of Object.entries(data.tactics ?? {})) {
    const seri = /^SERI:([1-9])$/.exec(t ?? '');
    if (!seri) continue;
    const from = lines.findIndex(g => g.length === 1 && g[0] === Number(car));
    if (from < 0) continue;
    const [solo] = lines.splice(from, 1);
    const to = lines.findIndex(g => g[0] === Number(seri[1]));
    lines.splice(to + 1, 0, solo);
  }

  const riders = {};
  for (const [car, info] of Object.entries(infoByCar)) {
    riders[car] = { ...info.profile };
    const tactic = data.tactics?.[car], front = data.frontResponse?.[car];
    if (TACTIC_CODES.includes(tactic)) riders[car].tactic = tactic;
    const seri = /^SERI:([1-9])$/.exec(tactic ?? '');
    if (seri) riders[car].seriTarget = Number(seri[1]); // 単騎で、この選手のラインの番手を競る
    if (front === 'TSUPPARI' || front === 'YIELD') riders[car].frontResponse = front;
  }
  const setupLines = [];
  lines.forEach((group, index) => {
    if (group.length === 1) { riders[group[0]].solo = true; return; }
    setupLines.push({ id: `LINE_${index + 1}`, members: group, leader: group[0] });
    riders[group[0]].mindset = mindsetFor(infoByCar[group[0]]);
  });
  // 9人未満のレースでも、出走しない車番は空けておく
  return {
    trackProfile: 'PROFILE_400',
    lines: setupLines,
    riders,
    formation: lines,
    meta: {
      race: data.race ?? {},
      names: Object.fromEntries(Object.entries(infoByCar).map(([c, i]) => [c, i.name])),
      conversion: Object.fromEntries(Object.entries(infoByCar).map(([c, i]) => [c, i.why])),
      rulesVersion: CONVERSION_RULES_VERSION
    }
  };
}

// 入力例 (画面の「サンプルを入れる」で使う)
export const SAMPLE_RACE_DATA = Object.freeze({
  race: { venue: 'サンプル', raceNo: 11, name: 'S級決勝 (架空)' },
  riders: [
    { car: 1, name: '選手A', class: 'S1', score: 115.2, style: '逃', back: 14, start: 6 },
    { car: 2, name: '選手B', class: 'S1', score: 112.0, style: '追', back: 1, start: 2 },
    { car: 3, name: '選手C', class: 'S2', score: 108.4, style: '追', back: 0, start: 0 },
    { car: 4, name: '選手D', class: 'S1', score: 116.8, style: '両', back: 7, start: 2 },
    { car: 5, name: '選手E', class: 'S1', score: 111.5, style: '追', back: 2, start: 1 },
    { car: 6, name: '選手F', class: 'S2', score: 107.9, style: '追', back: 0, start: 0 },
    { car: 7, name: '選手G', class: 'S1', score: 113.6, style: '逃', back: 16, start: 1 },
    { car: 8, name: '選手H', class: 'S2', score: 110.1, style: '追', back: 1, start: 0 },
    { car: 9, name: '選手I', class: 'S2', score: 106.3, style: '追', back: 0, start: 0 }
  ],
  lines: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
  autoFormation: false
});
