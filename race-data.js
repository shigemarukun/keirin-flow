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

// ---------- 級班 ----------
// 競走得点は直近4か月、級班は半年の成績で決まる。得点の目安: SS 115〜 / S1 105〜114 / S2 96〜104 / A1 85〜95 / A2 74〜84 / A3 65〜73
// level = その級班の「ふつう」の得点。family = 一緒に走るレースのまとまり (S級戦 / A級1・2班戦 / チャレンジ / ガールズ)
export const CLASSES = Object.freeze({
  SS: { label: 'SS', name: 'S級S班', family: 'S', level: 117 },
  S1: { label: 'S1', name: 'S級1班', family: 'S', level: 109 },
  S2: { label: 'S2', name: 'S級2班', family: 'S', level: 100 },
  A1: { label: 'A1', name: 'A級1班', family: 'A', level: 90 },
  A2: { label: 'A2', name: 'A級2班', family: 'A', level: 80 },
  A3: { label: 'A3', name: 'A級3班', family: 'C', level: 70 },
  L1: { label: 'L1', name: 'ガールズ', family: 'L', level: 52 }
});
// レースのクラス (出走表の「S級」「A級」「チャレンジ」「ガールズ」)
export const RACE_GRADES = Object.freeze({ S: 'S級', A: 'A級 (1・2班戦)', C: 'A級チャレンジ', L: 'ガールズ' });
// そのクラスのレースでの「ふつう」の得点。ここを基準に、選手どうしの得点差を脚の差にする
const FAMILY_REF = Object.freeze({ S: 100, A: 86, C: 72, L: 50 });
// 経歴: 得点や級班だけでは実力が測れない選手
export const HISTORY = Object.freeze({
  UP: { label: '昇級したばかり', note: '得点は下のクラスで取ったもの' },
  TOKUSHIN: { label: '特別昇級', note: '下のクラスで連勝して特進。勢いあり' },
  EX_SS: { label: '元SS', level: 117, note: '本来はS級S班の脚' },
  EX_S1: { label: '元S1', level: 109, note: '本来はS級1班の脚' },
  EX_S2: { label: '元S2', level: 100, note: '本来はS級2班の脚' },
  EX_A1: { label: '元A1', level: 90, note: '本来はA級1班の脚' }
});

// "S1" "Ｓ１" "S級1班" "SS" "S班" "A3" "L1" "ガールズ" などを級班コードにする
export function normalizeClass(v) {
  const t = String(v ?? '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).toUpperCase().replace(/\s/g, '');
  if (!t) return null;
  if (/^SS$|S級S班|^S班$|SS班/.test(t)) return 'SS';
  if (/ガールズ|^L/.test(t)) return 'L1';
  const m = t.match(/([SA])級?([123])班?/);
  if (m && !(m[1] === 'S' && m[2] === '3')) return `${m[1]}${m[2]}`;
  return null;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = v => Math.round(v * 100) / 100;
const round1 = v => Math.round(v * 10) / 10;
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
    if (r.class && !normalizeClass(r.class)) errors.push(`${r.car}番の級班「${r.class}」が読めません (SS/S1/S2/A1/A2/A3/L1)`);
    if (r.history && !HISTORY[r.history]) errors.push(`${r.car}番の経歴「${r.history}」が読めません`);
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
  for (const [car, f] of Object.entries(data?.frontResponse ?? {})) if (f && !['TSUPPARI', 'HIKU', 'CHUDAN', 'YIELD'].includes(f)) errors.push(`${car}番の前受けの対応「${f}」は指定できません`);
  for (const [car, o] of Object.entries(data?.tenkai ?? {})) {
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) if (!['strike', 'banteMakuri', 'switchTo', 'tobitsuki', 'noBlock', 'cutPacer'].includes(k)) errors.push(`${car}番の展開の指定「${k}」は分かりません`);
    if (o.switchTo != null && !(Number(o.switchTo) >= 1 && Number(o.switchTo) <= 9 && Number(o.switchTo) !== Number(car))) errors.push(`${car}番の切り替え先が正しくありません`);
  }
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
export const isGirls = data => !!(data?.girls ?? data?.race?.girls) || data?.race?.grade === 'L'
  || (Array.isArray(data?.riders) && data.riders.length > 0 && data.riders.every(r => normalizeClass(r.class) === 'L1'));

// レースのクラス: 指定があればそれ、なければ選手の級班から、それもなければ得点から推定する
export function raceFamily(data) {
  if (isGirls(data)) return 'L';
  if (FAMILY_REF[data?.race?.grade]) return data.race.grade;
  const fams = (data?.riders ?? []).map(r => CLASSES[normalizeClass(r.class)]?.family).filter(Boolean);
  if (fams.includes('S')) return 'S';
  if (fams.includes('A')) return 'A';
  if (fams.length && fams.every(f => f === 'C')) return 'C';
  const scores = (data?.riders ?? []).map(r => Number(r.score)).filter(Number.isFinite).sort((a, b) => a - b);
  const mid = scores.length ? scores[Math.floor(scores.length / 2)] : 105;
  return mid >= 94 ? 'S' : mid >= 77 ? 'A' : 'C';
}

// 選手の「実力の得点」: 競走得点に、級班(長い目で見た実力)と経歴を加える
export function riderLevel(r, family = 'S') {
  const code = normalizeClass(r.class), cls = CLASSES[code], hist = HISTORY[r.history];
  const ref = FAMILY_REF[family] ?? 100;
  const raw = num(r.score, cls?.level ?? ref);
  const steps = [];
  let level = raw;
  // 得点は直近4か月、級班は半年の成績。調子の波をならすため、級班の「ふつう」の得点を2割まぜる
  // (同じ得点なら上の班のほうが強い)
  if (cls && cls.family === family && family !== 'L') {
    level = raw * 0.8 + cls.level * 0.2;
    steps.push(`${cls.name}を加味 ${raw}→${round1(level)}`);
  }
  if (r.history === 'UP') { level -= 4; steps.push('昇級したばかり(得点は下のクラスのもの) −4'); }
  if (r.history === 'TOKUSHIN') { level -= 1; steps.push('特別昇級(下のクラスの得点 −4、連勝の勢い +3)'); }
  if (hist?.level && level < hist.level - 4) {
    level = hist.level - 4; // ブランクを考えて少し引く
    steps.push(`${hist.note} → ${level}点相当`);
  }
  return { raw, level, ref, steps, code, family };
}

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
export function riderToProfile(r, { girls = false, family = girls ? 'L' : 'S' } = {}) {
  const lv = riderLevel(r, family);
  // レースのクラスの「ふつう」の得点からの差を、地力の差にする (S級戦もA級戦も、決まり手の割合はほぼ同じ)
  // ガールズの得点は50点台に詰まっているので、1点の重みを2.5倍にする (50点→男子の100点、58点→120点)
  const score = family === 'L' ? 100 + (lv.level - lv.ref) * 2.5 : 100 + (lv.level - lv.ref);
  const rawScore = lv.raw;
  const rec0 = kimariteRecord(r.kimarite);
  // 昇級したばかり・特進の選手の決まり手は下のクラスでの実績なので、少し弱めに使う
  const rec = rec0 && ['UP', 'TOKUSHIN'].includes(r.history) ? { ...rec0, weight: rec0.weight * 0.7 } : rec0;
  // 脚質が未入力なら、決まり手の実績から決める
  const exStyle = styleFromEx(r.ex);
  const style = Object.values(STYLE).includes(r.style) ? r.style : (exStyle ?? rec?.style ?? STYLE.RYO);
  const back = clamp(num(r.back, style === STYLE.NIGE ? 8 : style === STYLE.RYO ? 4 : 1), 0, 30);
  const power = clamp(0.70 + (score - 100) * 0.0125, 0.40, 1.0);
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
  // EXデータ: ちぎり率 (前を走って後ろを千切る=ダッシュ力) / ちぎられ率 (付いていけない)
  const tend = exTendencies(r.ex);
  if (tend?.chigiri != null) profile.acceleration = round2(clamp(profile.acceleration + (tend.chigiri - 0.12) * 0.3, 0.4, 1.05));
  if (tend?.chigirare != null) profile.followAllowance = round2(clamp(0.6 + (0.05 - tend.chigirare) * 4, 0.3, 0.8));
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
    `競走得点${rawScore}${r.score === undefined || r.score === '' ? '(未入力のため仮)' : ''}${lv.steps.length ? ` (${lv.steps.join('、')})` : ''} → ${RACE_GRADES[family] ?? ''}のふつう(${lv.ref}点)と比べて地力${profile.power}`,
    `脚質「${style}」${r.style ? '' : '(未入力のため両で仮置き)'}`,
    `B${back}回 → 先行意欲${profile.aggression}`
  ];
  if (r.ex) {
    const t = r.ex.tactics ?? {}, fmt = c => (c ? `${Math.round(c.s / Math.max(1, c.n) * 100)}%(${c.s}/${c.n})` : '—');
    why.push(`EX: 突っ張り${fmt(t.tsuppari)} かまし${fmt(t.kamashi)} ちぎり${fmt(t.chigiri)} ちぎられ${fmt(t.chigirare)}${exStyle && !r.style ? ` → 脚質「${exStyle}」(先頭${r.ex.finish?.asLeader?.n ?? 0}回・番手${r.ex.finish?.asBante?.n ?? 0}回から)` : ''}`);
  }
  if (rec) {
    const c = rec.counts, lean = rec.oi >= 0.6 ? '追い込み型' : rec.makuri > rec.nige ? '捲り型' : '先行型';
    why.push(`決まり手 逃${c.nige} 捲${c.makuri} 差${c.sashi} マ${c.mark} → ${lean}${rec.weight < 1 ? ' (回数が少ないので弱めに反映)' : ''}`);
  }
  return { profile, style, back, start: num(r.start, 0), why, rec, ex: r.ex ?? null };
}

// レースの種別 (準決勝・決勝・予選…)。EXデータのレース種別の成績を使うため
export function raceKindOf(race) {
  if (race?.kind) return race.kind;
  const t = `${race?.name ?? ''}`;
  return /準決勝/.test(t) ? 'semifinal' : /決勝/.test(t) ? 'final' : /予選/.test(t) ? 'heat' : /特選|選抜/.test(t) ? 'special' : /一般/.test(t) ? 'general' : null;
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
    const family = raceFamily(data);
  for (const r of data.riders) infoByCar[Number(r.car)] = { ...riderToProfile(r, { family }), name: r.name ?? '', level: riderLevel(r, family) };

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
    riders[car].frontPlanProbs = frontPlanProbs(infoByCar[car].style, infoByCar[car].ex);
    if (infoByCar[car].ex && exTendencies(infoByCar[car].ex)?.tsuppariFreq != null) riders[car].frontPlanFromEx = true;
    // AIの第一候補: EXデータがあれば、その割合で一番多い動き。無ければ決め打ちせず、その場で相手と比べて決める
    // (何通りもの未来では、どちらの場合も割合で選ぶ)
    if (!riders[car].frontResponse && riders[car].frontPlanFromEx) riders[car].frontPlan = argmaxPlan(riders[car].frontPlanProbs);
    const kf = exTendencies(infoByCar[car].ex)?.kamashiFreq; if (kf != null) riders[car].kamashiFreq = round2(kf);
    // ガールズ: ラインがない個人戦なので、前で風を受けて先行するより、後ろから一気に仕掛ける(捲る)選手が多い
    // (実データの1着の決まり手: 捲り49% / 逃げ21%)。決まり手の実績が無い選手は、判断を捲り寄りに傾ける
    if (girls && !infoByCar[car].rec) riders[car].styleBias = round2((riders[car].styleBias ?? 0) - (globalThis.KF_TUNE?.gb ?? 0.08));
    if (girls) riders[car].strikeLater = globalThis.KF_TUNE?.gs ?? 200; // ガールズは最後の仕掛けがゴールに近い (検証: 逃げ22/捲り56/差し23)
    const seri = /^SERI:([1-9])$/.exec(tactic ?? '');
    if (seri && !girls) riders[car].seriTarget = Number(seri[1]); // 単騎で、この選手のラインの番手を競る
    if (['TSUPPARI', 'HIKU', 'CHUDAN', 'YIELD'].includes(front)) riders[car].frontResponse = front === 'YIELD' ? 'CHUDAN' : front;
    // 文章などで指定した細かい展開 (仕掛けどころ・番手捲り・切り替え・飛びつき・ブロックしない・誘導切り)
    const tk = data.tenkai?.[car];
    if (tk) {
      if (Number.isFinite(Number(tk.strike)) && tk.strike !== null) riders[car].strikeRem = clamp(Number(tk.strike), 0, 1200);
      if (tk.banteMakuri != null && tk.banteMakuri !== false) riders[car].banteMakuriAt = clamp(Number(tk.banteMakuri) || 260, 70, 800);
      if (Number(tk.switchTo) >= 1) riders[car].switchTo = Number(tk.switchTo);
      if (tk.tobitsuki) riders[car].tobitsuki = tk.tobitsuki === true ? true : Number(tk.tobitsuki);
      if (tk.noBlock) riders[car].noBlock = true;
      if (tk.cutPacer) riders[car].cutPacer = true;
    }
  }
  const setupLines = [];
  lines.forEach((group, index) => {
    if (group.length === 1) { riders[group[0]].solo = true; return; }
    setupLines.push({ id: `LINE_${index + 1}`, members: group, leader: group[0] });
    // 前受けの構え: AIの第一候補 (突っ張る / 引く / 中団) に合わせる
    const plan = riders[group[0]].frontResponse ?? riders[group[0]].frontPlan;
    riders[group[0]].mindset = plan === 'TSUPPARI' ? 'TSUPPARI' : plan === 'CHUDAN' ? 'YIELD_AND_ROLL' : plan === 'HIKU' ? 'CONTAIN'
      : (infoByCar[group[0]].style === STYLE.NIGE ? 'CONTAIN' : 'YIELD_AND_ROLL'); // 逃: 相手次第 / 両・追: 出させる寄り
  });
  // 位置別・バンク別・レース種別のEX成績: その選手自身の平均と比べて、今回の役割・バンク・レースが得意かを見る
  // (地力の補正は ±0.03 まで。試行回数が少ない成績は平均に寄せる)
  const bankKey = `bank${[333, 500].includes(Number(data.bank ?? bankOfVenue(data.race?.venue))) ? Number(data.bank ?? bankOfVenue(data.race?.venue)) : 400}`;
  const kindKey = raceKindOf(data.race);
  const top3 = c => (c ? (c.w?.s ?? 0) + (c.p2?.s ?? 0) + (c.p3?.s ?? 0) : 0);
  for (const [car, info] of Object.entries(infoByCar)) {
    const f = info.ex?.finish; if (!f) continue;
    const secs = Object.values(f).filter(x => x?.n > 0);
    const totalN = secs.reduce((a, x) => a + x.n, 0); if (totalN < 10) continue;
    const avg = secs.reduce((a, x) => a + top3(x), 0) / totalN;
    const apt = key => { const x = f[key]; return x?.n > 0 ? (top3(x) + avg * 8) / (x.n + 8) - avg : 0; };
    const line = setupLines.find(l => l.members.includes(Number(car)));
    const pos = line ? line.members.indexOf(Number(car)) : -1;
    const roleKey = !line ? 'asSolo' : pos === 0 ? 'asLeader' : pos === 1 ? 'asBante' : 'asThird';
    const adj = clamp(0.06 * apt(roleKey) + 0.03 * apt(bankKey) + (kindKey ? 0.03 * apt(kindKey) : 0), -0.03, 0.03);
    if (Math.abs(adj) >= 0.005) {
      riders[car].power = round2(clamp(riders[car].power + adj, 0.4, 1.05));
      info.why.push(`EXの成績(${{ asLeader: '先頭時', asBante: '番手時', asThird: '3番手時', asSolo: '単騎時' }[roleKey]}・${bankKey.replace('bank', '')}バンク${kindKey ? `・${{ semifinal: '準決勝', final: '決勝', heat: '予選', special: '特選', general: '一般' }[kindKey]}` : ''})が本人の平均より${adj > 0 ? '良い' : '悪い'} → 地力${adj > 0 ? '+' : ''}${adj.toFixed(2)}`);
    }
  }
  // 今開催の成績 (この開催で走った着順): 調子の目安として、地力を少しだけ (±0.01まで) 動かす
  for (const [car, info] of Object.entries(infoByCar)) {
    const meet = data.riders.find(r => Number(r.car) === Number(car))?.meet;
    const pos = (meet ?? []).map(x => Number(x.pos)).filter(n => n >= 1 && n <= 9);
    if (!pos.length) continue;
    const avg = pos.reduce((a, b) => a + b, 0) / pos.length;
    const adj = round2(clamp((5 - avg) / 4, -1, 1) * 0.01 * Math.min(1, pos.length / 3));
    if (Math.abs(adj) >= 0.005) riders[car].power = round2(clamp(riders[car].power + adj, 0.4, 1.05));
    info.why.push(`今開催 ${pos.join('-')}着${Math.abs(adj) >= 0.005 ? ` → 調子${adj > 0 ? '良い' : '重い'} 地力${adj > 0 ? '+' : ''}${adj.toFixed(2)}` : ' (調子はふつう)'}`);
  }
  // 9人未満のレースでも、出走しない車番は空けておく
  return {
    // バンク: data.bank (333/400/500) か、競輪場の名前から
    trackProfile: `PROFILE_${[333, 500].includes(Number(data.bank ?? bankOfVenue(data.race?.venue))) ? Number(data.bank ?? bankOfVenue(data.race?.venue)) : 400}`,
    lines: setupLines,
    riders,
    // ガールズはヨコの動き(ブロック・番手の競り)が禁止
    rules: girls ? { girls: true, noBlock: true, family } : { family },
    formation: lines,
    meta: {
      race: data.race ?? {},
      names: Object.fromEntries(Object.entries(infoByCar).map(([c, i]) => [c, i.name])),
      conversion: Object.fromEntries(Object.entries(infoByCar).map(([c, i]) => [c, i.why])),
      // 選手の見立て (画面の「AIの選手の見立て」で使う)
      levels: Object.fromEntries(Object.entries(infoByCar).map(([c, i]) => [c, { cls: i.level.code, raw: i.level.raw, level: round1(i.level.level), steps: i.level.steps, history: data.riders.find(r => Number(r.car) === Number(c))?.history ?? null }])),
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

// ---------- 出走表の文字を貼り付けて読み取る ----------
// 出走表のページ(WINTICKET・KEIRIN.JP など)からコピーした文字から、選手・級班・得点・脚質・並びなどを拾う。
// サイトごとの書き方の違いに強くするため、表の形ではなく「車番+名前」を目印に選手ごとに区切って読む。
const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
const NOT_NAME = /^(逃|両|追|自在|先行|捲り?|差し?|マーク?|逃げ|級|班|S級|A級|L級|ガールズ|期|歳|才|選手名?|府県|年齢|期別|級班|脚質|ギヤ|ギア|競走得点|得点|勝率|連対率|並び|予想|本命|対抗|単騎|ライン|車番|枠番|出走表|直近|成績|決まり手|回数|着順|オッズ|人気|コメント|自力|番手|欠車|[SA][123]|SS|L1)$/;
const half = t => String(t ?? '').replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
const isNameToken = t => /^[぀-ヿ㐀-鿿々ヶ・]{1,7}$/.test(t) && !NOT_NAME.test(t) && !PREFS.includes(t) && !/^[ぁ-ん]+$/.test(t);

// ---------- WINTICKET EXデータ ----------
// 戦法別 (かまし・突っ張り・ちぎり・ちぎられ・飛びつき) と、位置別・バンク別・レース種別の着順。
// 「50% (1/2)」は割合だけでなく 分子/分母 を残す。「—」はデータなし (0とは区別して null)。
const EX_TACTIC_COLS = [['かまし', 'kamashi'], ['突っ張り', 'tsuppari'], ['ちぎられ', 'chigirare'], ['ちぎり', 'chigiri'], ['飛びつき', 'tobitsuki']];
const EX_CELL = /(\d+(?:\.\d+)?)\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)|[—―\-－ー–]+/g;
function exSectionKey(title) {
  const t = half(title);
  if (/ライン先頭|先頭時/.test(t)) return 'asLeader';
  if (/3番手/.test(t)) return 'asThird';
  if (/番手/.test(t)) return 'asBante';
  if (/単騎/.test(t)) return 'asSolo';
  const bank = t.match(/(333|335|400|500)\s*m?\s*バンク/); if (bank) return `bank${bank[1] === '335' ? 333 : bank[1]}`;
  if (/準決勝/.test(t)) return 'semifinal';
  if (/決勝/.test(t)) return 'final';
  if (/予選/.test(t)) return 'heat';
  if (/特選|選抜/.test(t)) return 'special';
  if (/一般/.test(t)) return 'general';
  return null;
}
export function parseExData(text) {
  const out = {};
  let title = '', cols = null, kind = null;
  for (const raw of half(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // 表の見出し行
    if (/かまし|突っ張り|ちぎ|飛びつき/.test(line) && /車番|率/.test(line) && !/^\d/.test(line)) {
      kind = 'tactics';
      cols = [...line.matchAll(/(かまし|突っ張り|ちぎられ|ちぎり|飛びつき)/g)].map(m => EX_TACTIC_COLS.find(([k]) => k === m[1])[1]);
      continue;
    }
    if (/1着/.test(line) && /2着/.test(line) && !/^\d/.test(line)) { kind = exSectionKey(title); cols = ['w', 'p2', 'p3', 'out']; continue; }
    const row = line.match(/^([1-9])(?![\d%.])\s+(.*)$/);
    if (row && cols && kind) {
      const cells = [...row[2].matchAll(EX_CELL)].map(m => (m[2] != null ? { s: Number(m[2]), n: Number(m[3]) } : null));
      if (cells.length < Math.min(2, cols.length)) continue;
      const car = Number(row[1]);
      const ex = out[car] ??= { tactics: {}, finish: {} };
      if (kind === 'tactics') cols.forEach((c, i) => { ex.tactics[c] = cells[i] ?? null; });
      else { const f = {}; cols.forEach((c, i) => { f[c] = cells[i] ?? null; }); f.n = cells.find(Boolean)?.n ?? 0; ex.finish[kind] = f; }
      continue;
    }
    // 見出しでも表の行でもない行 = 次の表のタイトル候補
    if (!/^[1-9]\s/.test(line)) { title = line; cols = null; kind = null; }
  }
  return out;
}

// EXデータから、その選手の「くせ」を出す。試行回数が少ない100%を過大評価しないよう、ふつうの値に寄せる
const shrinkRate = (c, prior, k) => (c && c.n > 0 ? (c.s + prior * k) / (c.n + k) : null);
export function exTendencies(ex) {
  if (!ex) return null;
  const t = ex.tactics ?? {}, f = ex.finish ?? {};
  const lead = f.asLeader?.n ?? 0;
  // 先頭で走ったレースのうち、前受けになるのはおよそ3回に1回。そのうち何回突っ張ったか
  const frontChances = lead / 3;
  return {
    lead,
    tsuppariFreq: lead >= 9 ? Math.min(0.6, ((t.tsuppari?.n ?? 0) + 0.5) / (frontChances + 3)) : null,
    tsuppariSuccess: shrinkRate(t.tsuppari, 0.6, 4),
    kamashiFreq: lead >= 9 ? Math.min(0.5, ((t.kamashi?.n ?? 0) + 0.5) / (lead + 5)) : null,
    chigiri: shrinkRate(t.chigiri, 0.12, 10),
    chigirare: shrinkRate(t.chigirare, 0.05, 10),
    tobitsuki: t.tobitsuki ?? null
  };
}
// 前受けになったときの動き方の割合: 突っ張る / 引く(後方へ下げて巻き返す) / 中団(前に入れて、その後ろを取る)
export function frontPlanProbs(style, ex) {
  const tend = exTendencies(ex);
  let tsu = tend?.tsuppariFreq ?? ({ [STYLE.NIGE]: 0.15, [STYLE.RYO]: 0.08, [STYLE.OI]: 0.03 }[style] ?? 0.08);
  if (tend?.tsuppariSuccess != null) tsu *= 0.5 + tend.tsuppariSuccess; // 突っ張りが決まる選手ほど突っ張る
  tsu = Math.min(0.6, tsu);
  const hikuShare = ({ [STYLE.NIGE]: 0.65, [STYLE.RYO]: 0.4, [STYLE.OI]: 0.2 }[style] ?? 0.4) * (globalThis.KF_TUNE?.hk ?? 1);
  const rest = 1 - tsu;
  return { TSUPPARI: round2(tsu), HIKU: round2(rest * hikuShare), CHUDAN: round2(rest * (1 - hikuShare)) };
}
export const FRONT_PLAN_LABEL = Object.freeze({ TSUPPARI: '突っ張る', HIKU: '引く', CHUDAN: '中団', YIELD: '中団' });
export const argmaxPlan = probs => Object.entries(probs ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

// 府県 → 地区 (並びの予想に使う。ラインは同じ地区で組むことが多い)
export const REGION_OF = Object.freeze(Object.fromEntries([
  ['北日本', ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島']],
  ['関東', ['茨城', '栃木', '群馬', '埼玉', '東京', '新潟', '長野']],
  ['南関東', ['千葉', '神奈川', '静岡', '山梨']],
  ['中部', ['富山', '石川', '福井', '岐阜', '愛知', '三重']],
  ['近畿', ['滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山']],
  ['中国', ['鳥取', '島根', '岡山', '広島', '山口']],
  ['四国', ['徳島', '香川', '愛媛', '高知']],
  ['九州', ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄']]
].flatMap(([region, prefs]) => prefs.map(p => [p, region]))));

// EXデータの「ライン先頭時」「番手時」の回数から、自力型か追込型かを見る (脚質が分からないとき用)
export function styleFromEx(ex) {
  const lead = ex?.finish?.asLeader?.n ?? 0, bante = ex?.finish?.asBante?.n ?? 0;
  if (lead + bante < 6) return null;
  const share = lead / (lead + bante);
  return share >= 0.9 ? STYLE.NIGE : share >= 0.35 ? STYLE.RYO : STYLE.OI;
}

// 並びの予想: 同じ地区の選手でラインを組む。自力型(逃→両)が先頭、後ろは格・得点の順。地区に1人なら単騎
export function predictLines(riders) {
  const styleRank = r => ({ [STYLE.NIGE]: 0, [STYLE.RYO]: 1, [STYLE.OI]: 2 }[r.style ?? styleFromEx(r.ex)] ?? 1);
  const strength = r => num(r.score, CLASSES[normalizeClass(r.class)]?.level ?? 100);
  // 先行度: EXデータでラインの先頭を走った割合 (なければB回数)
  const senkoDo = r => { const l = r.ex?.finish?.asLeader?.n ?? 0, b = r.ex?.finish?.asBante?.n ?? 0; return l + b >= 6 ? l / (l + b) : num(r.back, 0) / 30; };
  const groups = new Map();
  for (const r of riders) {
    const key = REGION_OF[r.pref] ?? `単騎${r.car}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const lines = [];
  for (const members of groups.values()) {
    // 自力型が先頭。自力型どうしなら先行度が高い方、同じくらいなら弱い方が前を引き、強い方が番手 (よくある形)
    members.sort((a, b) => styleRank(a) - styleRank(b) || (Math.abs(senkoDo(a) - senkoDo(b)) > 0.05 ? senkoDo(b) - senkoDo(a) : strength(a) - strength(b)));
    const line = [members[0], ...members.slice(1).sort((a, b) => strength(b) - strength(a))].map(r => Number(r.car));
    // 5人以上はラインが長すぎるので分ける
    if (line.length >= 5) { lines.push(line.slice(0, 3)); lines.push(line.slice(3)); } else lines.push(line);
  }
  return lines;
}

export function parseRaceCardText(text) {
  // 「S級2班」「S級S班」は先に「S2」「SS」にまとめておく (数字の前後で区切ると級班が切れてしまうため)
  const src = half(text).replace(/\r/g, '').replace(/([SAL])\s*級\s*([S123])\s*班/g, (_, a, b) => b === 'S' ? 'SS' : `${a}${b}`)
    // 「1番車 棚瀬義大」「1号車」「1番 棚瀬」は、車番だけにする
    .replace(/(^|\n)[ \t]*([1-9])[ \t]*(?:番車|号車|番|号)(?=[ \t]|[぀-ヿ㐀-鿿])/g, '$1$2 ');
  const warnings = [];
  // JSON をそのまま貼った場合
  try { const j = JSON.parse(src); if (j && Array.isArray(j.riders)) return { data: j, found: { riders: j.riders.length, lines: !!j.lines?.length }, warnings }; } catch { /* 文字として読む */ }

  // 並び: 「並び」「ライン」の後ろの数字、または 123/45/67 のような書き方
  let lines = [];
  const lineText = src.match(/(?:並び|ライン|周回)[^\n\d]{0,10}([1-9][1-9 \t\/\-・|｜←→]{2,40})/)?.[1]
    ?? src.match(/(?:^|[ \t])([1-9]{1,4}(?:[ \t]*[\/／|][ \t]*[1-9]{1,4}){1,6})(?=[ \t]|$)/m)?.[1];
  // 見出し (【周回予想ライン】【並び】など) の下に、1ラインずつ「1-9（棚瀬-長尾）」「5」のように書かれた形
  const sec = src.match(/(?:並び|ライン|周回)[^\n\d]*\n((?:[ \t]*[1-9](?:[ \t]*[-ー－・=][ \t]*[1-9])*[ \t]*(?:[（(][^)）\n]*[)）])?[ \t]*(?:\n|$)){2,9})/);
  if (sec) {
    const groups = [];
    for (const row of sec[1].split('\n')) {
      const m = row.match(/^[ \t]*([1-9](?:[ \t]*[-ー－・=][ \t]*[1-9])*)[ \t]*(?:[（(][^)）]*[)）])?[ \t]*$/);
      if (!m) break;
      groups.push(m[1].split(/[^1-9]+/).filter(Boolean).map(Number));
    }
    if (groups.length >= 2 && new Set(groups.flat()).size === groups.flat().length) lines = groups;
  }
  if (!lines.length && lineText) lines = parseLines(lineText.replace(/[←→]/g, ' '));

  // レース情報
  // 競輪場: 「小倉競輪」の形か、先頭の行から (高知・静岡など府県名と同じ競輪場があるので、選手の府県と間違えないように)
  const head = src.split('\n').slice(0, 2).join(' ');
  const venue = VENUES.find(v => src.includes(`${v.name}競輪`) || new RegExp(`競輪場\\s*[:：]\\s*${v.name}`).test(src))?.name ?? VENUES.find(v => head.includes(v.name) && !/^\s*[1-9]\s/.test(head))?.name;
  const raceNo = Number(src.match(/(?:^|[^\d])(1[0-2]|[1-9])\s*R(?![a-zA-Z])/)?.[1]) || undefined;
  const grade = /ガールズ|L級/.test(src) ? 'L' : /チャレンジ/.test(src) ? 'C' : /S級|S[12]\b|SS\b/.test(src) ? 'S' : /A級|A[12]\b/.test(src) ? 'A' : undefined;

  // 選手: 「車番(1〜9) + 名前」を目印に区切る (EXデータの表より前の部分だけを見る)
  const exStart = src.search(/EXデータ\s*[:：]|かまし成功率|ライン先頭時|^.*番手時/m);
  const cardSrc = exStart > 0 ? src.slice(0, exStart) : src;
  const tokens = [], lineOf = [];
  cardSrc.split('\n').forEach((row, li) => {
    for (const t of row.replace(/([぀-ヿ㐀-鿿々])([0-9])/g, '$1 $2').replace(/([0-9])([㐀-鿿])/g, '$1 $2').split(/[\s,，、|｜\t]+/).filter(Boolean)) { tokens.push(t); lineOf.push(li); }
  });
  const firstOfLine = i => i === 0 || lineOf[i - 1] !== lineOf[i];
  // 1行に1人ずつ (車番 名前 府県 … 得点) 書かれた出走表なら、行の先頭の車番だけを目印にする
  // (「9車立て」「5周」などを選手と間違えないように)
  const scoreRe = /^(?:1[0-2]\d|[4-9]\d)\.\d{2}$/;
  const perLine = cardSrc.split('\n').filter(row => /^\s*[1-9]\s+\S/.test(row) && /(?:^|[^\d.])(?:1[0-2]\d|[4-9]\d)\.\d{2}(?![\d])/.test(row)).length >= 5;
  const anchors = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!/^[1-9]$/.test(tokens[i])) continue;
    if (perLine && !(firstOfLine(i) && tokens.some((t, k) => lineOf[k] === lineOf[i] && scoreRe.test(t.replace(/^[^\d]*/, ''))))) continue;
    const car = Number(tokens[i]);
    if (anchors.some(a => a.car === car)) continue;
    // 名前は車番のすぐ後ろ (枠番が間にある書き方にも対応して2つ先まで見る)
    const j = isNameToken(tokens[i + 1]) ? i + 1 : (/^[1-9]$/.test(tokens[i + 1]) && isNameToken(tokens[i + 2]) ? i + 2 : -1);
    if (j < 0) continue;
    anchors.push({ car, at: i, nameAt: j });
  }
  const riders = anchors.map((a, k) => {
    let block = tokens.slice(a.nameAt, k + 1 < anchors.length ? anchors[k + 1].at : tokens.length);
    if (perLine) block = block.filter((_, x) => lineOf[a.nameAt + x] === lineOf[a.at]); // その選手の行だけ
    // 姓と名が空白で分かれていればつなげる
    let name = block[0];
    if (isNameToken(block[1]) && name.length + block[1].length <= 7 && !/[逃両追]/.test(block[1])) name += ' ' + block[1];
    const rest = block.join(' ');
    const r = { car: a.car, name };
    const pref = block.slice(1, 6).map(t => t.replace(/[\/].*$/, '')).find(t => PREFS.includes(t));
    if (pref) r.pref = pref;
    const cls = block.map(normalizeClass).find(Boolean) ?? normalizeClass(rest.match(/[SAL]級\s*[S123]班/)?.[0]);
    if (cls) r.class = cls;
    // 競走得点: 小数2桁の数 (例 104.80)。ガールズは50点台
    const score = rest.match(/(?:^|\s)((?:1[0-2]\d|[4-9]\d)\.\d{2})(?=\s|$|点)/)?.[1];
    if (score) r.score = Number(score);
    const style = block.find(t => /^(逃|両|追|自在|先行|追込|マーク)$/.test(t));
    if (style) r.style = { 逃: '逃', 先行: '逃', 両: '両', 自在: '両', 追: '追', 追込: '追', マーク: '追' }[style];
    const back = rest.match(/(?:^|\s)B\s*:?\s*(\d{1,2})(?=\s|$)/)?.[1]; if (back != null) r.back = Number(back);
    // S回数: 「S:4」「S 4」「S4」。ただし「S1」「S2」は級班なのでS回数とは読まない
    const sm = [...rest.matchAll(/(?:^|\s)S(?:回数)?(\s*[:=]?\s*)(\d{1,2})(?=\s|$)/g)]
      .find(x => !(x[1] === '' && ['1', '2'].includes(x[2]))); // 「S1」「S2」(すき間なし) は級班
    // 「S1 B7」のように S のすぐ後ろに B が続くなら、それは級班ではなく S回数 (級班は別に書いてある)
    const sb = rest.match(/(?:^|\s)S\s*:?\s*(\d{1,2})\s+B\s*:?\s*\d{1,2}(?=\s|$)/);
    const start = sb ? sb[1] : sm ? sm[2] : null;
    if (start != null) r.start = Number(start);
    // 「S H B」の列がある表 (例 WINTICKETの基本情報: 得点 114.33 のあとに S 3  H 2  B 5 が数字だけで並ぶ)
    if (score && back == null && start == null && /S\s+H\s+B/.test(src)) {
      const after = rest.slice(rest.indexOf(score) + score.length).trim().split(/\s+/);
      if (after.length >= 3 && after.slice(0, 3).every(t => /^\d{1,2}$/.test(t))) { r.start = Number(after[0]); r.back = Number(after[2]); }
    }
    // S/H/B の並び (例 4 / 13 / 8)
    const shb = rest.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (shb && back == null && start == null && /S\s*\/\s*H\s*\/\s*B/.test(src)) { r.start = Number(shb[1]); r.back = Number(shb[3]); }
    // 決まり手: 「逃げ 19.0%」「逃 3」など
    const kim = {};
    for (const [key, re] of [['nige', /逃げ?\s*:?\s*(\d+(?:\.\d)?)\s*(%?)/], ['makuri', /捲り?\s*:?\s*(\d+(?:\.\d)?)\s*(%?)/], ['sashi', /差し?\s*:?\s*(\d+(?:\.\d)?)\s*(%?)/], ['mark', /マー?ク?\s*:?\s*(\d+(?:\.\d)?)\s*(%?)/]]) {
      const m = rest.match(re); if (m) kim[key] = m[2] || m[1].includes('.') ? kimariteFromPercent(Number(m[1])) : Number(m[1]);
    }
    if (Object.keys(kim).length >= 2) r.kimarite = kim;
    return r;
  });
  // EXデータ (あれば) を選手に付ける
  // 今開催の成績: 「【今開催成績】」などの見出しの下に「1 棚瀬：一次予選2着 二次予選4着 準決勝7着」
  const meetSec = src.match(/(?:今開催|今節|開催成績|節成績)[^\n]*\n((?:[ \t]*[1-9][^\n]*\n?){1,9})/);
  if (meetSec) for (const row of meetSec[1].split('\n')) {
    const m = row.match(/^[ \t]*([1-9])[ \t]/); if (!m) continue;
    const res = [...row.matchAll(/([぀-ヿ㐀-鿿A-Za-z]{0,8}?)[ \t]*([1-9])着/g)].map(x => ({ stage: x[1], pos: Number(x[2]) }));
    const r = riders.find(x => x.car === Number(m[1]));
    if (r && res.length) r.meet = res;
  }
  const ex = parseExData(src);
  for (const r of riders) if (ex[r.car]) r.ex = ex[r.car];
  const exCount = Object.keys(ex).length;
  // 並びが無ければ、AIが地区と脚質から予想する (あとで自由に直せる)
  let linesPredicted = false;
  if (!riders.length) warnings.push('選手を見つけられませんでした。車番と選手名が入った部分をコピーしてください');
  // 並びが見つからなければ、「車番がちょうど全員分そろっている行」を並びとして使う (例: ←123 45 67)
  if (riders.length && !lines.length) {
    const cars = riders.map(r => r.car).sort().join('');
    for (const row of src.split('\n')) {
      if (!/^[\s←→\d\/\-・|｜]+$/.test(row)) continue;
      const g = parseLines(row.replace(/[←→]/g, ' '));
      if (g.flat().slice().sort().join('') === cars) { lines = g; break; }
    }
  }
  // それでも無ければ、AIが地区と脚質から並びを予想する (あとで自由に直せる)
  if (riders.length && !lines.length && riders.some(r => r.pref)) { lines = predictLines(riders); linesPredicted = true; warnings.push('並びが無かったので、AIが地区と脚質から予想しました。違っていたら下で直してください'); }
  if (riders.length && !lines.length) warnings.push('並びが見つかりませんでした。下のボタンで並びを入れてください');
  const missingScore = riders.filter(r => r.score == null).map(r => r.car);
  if (missingScore.length) warnings.push(`競走得点が読めなかった選手: ${missingScore.join(', ')}番 (級班から推定します)`);
  return {
    data: { race: { venue, raceNo, grade: grade === 'L' ? undefined : grade, girls: grade === 'L' || undefined, kind: raceKindOf({ name: src.match(/準決勝|決勝|予選|特選|選抜|一般/)?.[0] }) ?? undefined }, riders, lines },
    found: { riders: riders.length, lines: lines.length > 0, venue: !!venue, ex: exCount, linesPredicted },
    warnings
  };
}

// WINTICKET などの「連対時の決まり手 19.0%」は出走数に対する割合。直近4か月をおよそ20走として回数に直す
export function kimariteFromPercent(p) { return Math.round(Math.max(0, p) / 100 * 20 * 10) / 10; }
