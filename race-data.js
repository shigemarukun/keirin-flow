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
//       back: 12, start: 3, gear: 3.92, comment: '自力',
//       kimarite: { nige: 3, makuri: 6, sashi: 1, mark: 0 } },   // 決まり手の回数 (出走表の 逃・捲・差・マ)
//     ...
//   ],
//   lines:  [[1, 2, 3], [4, 5, 6], [7, 8, 9]],   // 並び (周回の前から順に)。単騎は [8] のように1人で書く
//   autoFormation: false,                         // true ならAIが周回の並び順を決める
//   girls: false                                  // ガールズケイリン: ラインなし(全員単騎)・ブロック禁止
// }
//
// 変換ルール v0 (すべて仮の数字。実際のレース結果と比べて調整していく前提)
//   競走得点 score  → 地力 power      : 100点=0.70、120点=0.95 の直線
//   脚質 style      → 戦法の傾向       : 逃=先行寄り / 両=捲り寄り / 追=番手・マーク寄り
//   バック回数 back → 先行意欲 aggression
//   S回数 start     → 前受け・位置取りの強さ (隊列をAIに任せたときに使う)
//   決まり手 kimarite → 実際にどう勝って(連に絡んで)きたか。逃げが多い=先行型、捲りが多い=捲り型、
//                      差し・マークが多い=追い込み型。回数が多いほど強く効く (脚質の入力より実績を優先)
//   ギヤ倍数・年齢・級班 → v0 では使わない (効くかどうか後で検証する)

// 競輪場とバンクの周長 (333・335m=7場 / 500m=3場 / ほかは400m)。前橋は335mだが333として扱う
// (千葉の250mバンク・PIST6 は別の競技形式なので対象外)
export const VENUES = Object.freeze([
  ['函館', 400], ['青森', 400], ['いわき平', 400], ['弥彦', 400], ['前橋', 333], ['取手', 400], ['宇都宮', 500], ['大宮', 500],
  ['西武園', 400], ['京王閣', 400], ['立川', 400], ['松戸', 333], ['川崎', 400], ['平塚', 400], ['小田原', 333],
  ['伊東温泉', 333], ['静岡', 400], ['名古屋', 400], ['岐阜', 400], ['大垣', 400], ['豊橋', 400], ['富山', 333], ['松阪', 400],
  ['四日市', 400], ['福井', 400], ['奈良', 333], ['向日町', 400], ['和歌山', 400], ['岸和田', 400], ['玉野', 400], ['広島', 400],
  ['防府', 333], ['高松', 400], ['小松島', 400], ['高知', 500], ['松山', 400], ['小倉', 400], ['久留米', 400], ['武雄', 400],
  ['佐世保', 400], ['別府', 400], ['熊本', 400]
].map(([name, bank]) => Object.freeze({ name, bank })));
export const bankOfVenue = name => VENUES.find(v => v.name === name)?.bank ?? null;

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
    for (const [k, label] of Object.entries(KIMARITE_LABEL)) {
      const v = r.kimarite?.[k];
      if (v !== undefined && v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) errors.push(`${r.car}番の決まり手「${label}」の回数が数字ではありません`);
    }
  }
  const girls = isGirls(data);
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
    if (seri && girls) { errors.push('ガールズケイリンにはラインがないので、番手を競る指定はできません'); continue; }
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

// 決まり手 (出走表の「逃・捲・差・マ」の回数)
export const KIMARITE_LABEL = Object.freeze({ nige: '逃', makuri: '捲', sashi: '差', mark: 'マ' });
export const isGirls = data => !!(data?.girls ?? data?.race?.girls);

// 決まり手の回数から「どう勝ってきた選手か」を出す。回数が少ないうちは弱めに効かせる
export function kimariteRecord(k) {
  const c = Object.fromEntries(Object.keys(KIMARITE_LABEL).map(key => [key, Math.max(0, num(k?.[key], 0))]));
  const total = c.nige + c.makuri + c.sashi + c.mark;
  if (total < 1) return null;
  const nige = c.nige / total, makuri = c.makuri / total, oi = (c.sashi + c.mark) / total;
  const weight = clamp(total / 8, 0.25, 1); // 8回以上あれば実績を目いっぱい信じる
  const style = nige + makuri < 0.4 ? STYLE.OI : nige >= makuri ? STYLE.NIGE : STYLE.RYO;
  return { counts: c, total, nige, makuri, oi, weight, style };
}

// ---------- 1人分の変換 ----------
export function riderToProfile(r, { girls = false } = {}) {
  // ガールズの競走得点は50点台が中心 (男子は100点前後) なので、男子と同じ物差しに直す: 50点→100点、58点→120点
  const rawScore = num(r.score, girls ? 52 : 105);
  const score = girls || rawScore < 75 ? 100 + (rawScore - 50) * 2.5 : rawScore;
  const rec = kimariteRecord(r.kimarite);
  // 脚質が未入力なら、決まり手の実績から決める
  const style = Object.values(STYLE).includes(r.style) ? r.style : (rec?.style ?? STYLE.RYO);
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
  if (rec) {
    // 実績を能力に反映: 捲りで勝つ選手は一瞬のダッシュ、逃げで勝つ選手は長く踏める脚と先行意欲、
    // 差し・マークで勝つ選手は直線の伸び。styleBias は「先行か捲りか」の判断の傾き (+で先行、-で捲り)
    const w = rec.weight;
    profile.acceleration = round2(clamp(profile.acceleration + (rec.makuri * 0.06 + rec.oi * 0.03) * w, 0.4, 1.05));
    profile.endurance = round2(clamp(profile.endurance + rec.nige * 0.04 * w, 0.4, 1.05));
    profile.aggression = round2(clamp(profile.aggression + (rec.nige - 0.3) * 0.25 * w, 0.2, 1));
    profile.styleBias = round2((rec.nige - rec.makuri) * 0.30 * w);
  }

  const why = [
    `競走得点${rawScore}${score !== rawScore ? `(ガールズの得点。男子の${Math.round(score)}点相当)` : ''}${r.score === undefined || r.score === '' ? '(未入力のため仮)' : ''} → 地力${profile.power}`,
    `脚質「${style}」${r.style ? '' : '(未入力のため両で仮置き)'}`,
    `B${back}回 → 先行意欲${profile.aggression}`
  ];
  if (rec) {
    const c = rec.counts, lean = rec.oi >= 0.6 ? '追い込み型' : rec.makuri > rec.nige ? '捲り型' : '先行型';
    why.push(`決まり手 逃${c.nige} 捲${c.makuri} 差${c.sashi} マ${c.mark} → ${lean}${rec.weight < 1 ? ' (回数が少ないので弱めに反映)' : ''}`);
  }
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
  for (const r of data.riders) infoByCar[Number(r.car)] = { ...riderToProfile(r, { girls: isGirls(data) }), name: r.name ?? '' };

  const girls = isGirls(data);
  let lines = data.lines.map(l => l.map(Number));
  // ガールズ: ラインはなく全員が単騎。並びは周回の前からの順番としてだけ使う
  if (girls) lines = lines.flat().map(n => [n]);
  if (data.autoFormation && !girls) lines = orderLinesAuto(lines, infoByCar);
  // 番手を競る単騎は、競る相手のラインのすぐ後ろからスタートする
  for (const [car, t] of Object.entries(data.tactics ?? {})) {
    const seri = /^SERI:([1-9])$/.exec(t ?? '');
    if (!seri || girls) continue;
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
    if (seri && !girls) riders[car].seriTarget = Number(seri[1]); // 単騎で、この選手のラインの番手を競る
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
    // バンク: data.bank (333/400/500) か、競輪場の名前から
    trackProfile: `PROFILE_${[333, 500].includes(Number(data.bank ?? bankOfVenue(data.race?.venue))) ? Number(data.bank ?? bankOfVenue(data.race?.venue)) : 400}`,
    lines: setupLines,
    riders,
    // ガールズはヨコの動き(ブロック・番手の競り)が禁止
    rules: girls ? { girls: true, noBlock: true } : {},
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
