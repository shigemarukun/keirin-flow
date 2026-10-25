// KEIRIN FLOW — 出走表(レースデータ)の変換テスト
import { toRaceSetup, validateRaceData, parseLines, riderToProfile, SAMPLE_RACE_DATA, normalizeClass, raceFamily, riderLevel, parseRaceCardText, kimariteFromPercent, parseExData, styleFromEx, predictLines, frontPlanProbs, exTendencies } from './race-data.js';
import { PhysicsEngine } from './engine.js';

let failures = 0;
const check = (ok, label, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!ok) failures += 1; };
const race = setup => { const e = new PhysicsEngine(setup); e.start(); for (let t = 0; t < 120 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60); return e; };

const sample = race(toRaceSetup(structuredClone(SAMPLE_RACE_DATA)));
check(sample.ranking.length === 9, 'サンプル出走表で9人全員が完走する', sample.ranking.map(r => r.number).join('-'));

const seven = structuredClone(SAMPLE_RACE_DATA);
seven.riders = seven.riders.filter(r => r.car !== 3 && r.car !== 6);
seven.lines = parseLines('12/45/7/89');
const s7 = race(toRaceSetup(seven));
check(s7.riders.length === 7 && s7.ranking.length === 7, '7車立て・単騎ありでも全員完走する', s7.ranking.map(r => r.number).join('-'));

check(JSON.stringify(parseLines('１２３／４５６ 7-8-9')) === '[[1,2,3],[4,5,6],[7,8,9]]', '並びは全角・区切り記号の違いを吸収して読める');

const errs = validateRaceData({ riders: [{ car: 1 }, { car: 1 }, { car: 2, style: '捲' }], lines: [[1, 3]] });
check(errs.length >= 3, '入力ミス(車番の重複・脚質の誤り・並びの抜け)をすべて指摘する', errs.join(' / '));

const strong = riderToProfile({ score: 118, style: '逃' }).profile, weak = riderToProfile({ score: 102, style: '逃' }).profile;
check(strong.power > weak.power, '競走得点が高いほど地力が高い', `${strong.power} > ${weak.power}`);
const nige = riderToProfile({ score: 110, style: '逃', back: 15 }).profile, oi = riderToProfile({ score: 110, style: '追', back: 0 }).profile;
check(nige.aggression > oi.aggression && oi.blockSkill > nige.blockSkill, '逃は先行意欲が高く、追はブロックが強い');

const auto = toRaceSetup({ ...structuredClone(SAMPLE_RACE_DATA), lines: [[7, 8, 9], [4, 5, 6], [1, 2, 3]], autoFormation: true });
check(auto.formation[0][0] === 1, 'AIに隊列を任せると、S回数の多い先頭のラインが前受けになる', JSON.stringify(auto.formation));

{
  const d = structuredClone(SAMPLE_RACE_DATA);
  d.race = { venue: '松戸' }; const a = toRaceSetup(d).trackProfile;
  d.race = { venue: '大宮' }; const b = toRaceSetup(d).trackProfile;
  d.race = { venue: '小倉' }; const c = toRaceSetup(d).trackProfile;
  check(a === 'PROFILE_333' && b === 'PROFILE_500' && c === 'PROFILE_400', '競輪場を選ぶとバンクの周長が決まる (松戸333 / 大宮500 / 小倉400)', `${a} ${b} ${c}`);
}

// ---------- 決まり手の実績 ----------
{
  const mk = riderToProfile({ score: 112, style: '両', kimarite: { nige: 0, makuri: 8, sashi: 1, mark: 0 } }).profile;
  const ng = riderToProfile({ score: 112, style: '両', kimarite: { nige: 8, makuri: 1, sashi: 0, mark: 0 } }).profile;
  const none = riderToProfile({ score: 112, style: '両' }).profile;
  check(mk.styleBias < 0 && ng.styleBias > 0 && mk.acceleration > none.acceleration && ng.aggression > none.aggression,
    '決まり手の実績: 捲りが多い選手は捲り寄り・ダッシュ力が上がり、逃げが多い選手は先行寄りになる', `捲${mk.styleBias} 逃${ng.styleBias}`);
  const derived = riderToProfile({ score: 110, kimarite: { nige: 0, makuri: 1, sashi: 5, mark: 6 } });
  check(derived.style === '追', '脚質が空欄でも、決まり手が差し・マーク中心なら「追」として扱う', derived.style);
  const few = riderToProfile({ score: 112, style: '両', kimarite: { makuri: 1 } }).profile;
  check(Math.abs(few.styleBias) < Math.abs(mk.styleBias), '決まり手の回数が少ないうちは、実績を弱めに反映する', `${few.styleBias} vs ${mk.styleBias}`);
  const bad = validateRaceData({ riders: [{ car: 1, kimarite: { nige: 'あ' } }, { car: 2 }], lines: [[1], [2]] });
  check(bad.some(e => e.includes('決まり手')), '決まり手の回数が数字でなければ指摘する');
}

// ---------- ガールズケイリン ----------
{
  const g = { race: { venue: '小倉', girls: true }, riders: [1, 2, 3, 4, 5, 6, 7].map(car => ({ car, score: 50 + car, style: '両' })), lines: [[1, 2, 3, 4, 5, 6, 7]] };
  const s = toRaceSetup(g);
  check(s.lines.length === 0 && Object.values(s.riders).every(r => r.solo) && s.formation.length === 7,
    'ガールズ: ラインは作らず、全員が単騎で、並びは周回の順番として使う', JSON.stringify(s.formation));
  check(s.rules.noBlock === true, 'ガールズ: ブロック禁止のルールが付く');
  check(s.riders[7].power > s.riders[1].power && s.riders[1].power > 0.6, 'ガールズの競走得点(50点台)も、高いほど地力が高い', `${s.riders[1].power} → ${s.riders[7].power}`);
  const seri = validateRaceData({ ...g, tactics: { 1: 'SERI:2' } });
  check(seri.length > 0, 'ガールズでは番手を競る指定はできない');
  const e = new PhysicsEngine(s); e.start();
  for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
  check(e.ranking.length === 7 && !e.decisionLogs.some(l => l.action === 'BLOCK'), 'ガールズ7車: 全員完走し、ブロックが一度も起きない', e.ranking.map(r => r.number).join('-'));
}

// ---------- 級班と経歴 ----------
{
  const codes = ['S1', 'Ｓ１', 'S級1班', 'SS', 'S級S班', 'A3', 'A級2班', 'L1', 'ガールズ'].map(normalizeClass);
  check(codes.join(',') === 'S1,S1,S1,SS,SS,A3,A2,L1,L1', '級班の書き方の違い(全角・S級1班・S級S班など)を読める', codes.join(','));
  check(raceFamily({ riders: [{ class: 'A1' }, { class: 'A2' }] }) === 'A' && raceFamily({ riders: [{ class: 'A3' }] }) === 'C'
    && raceFamily({ riders: [{ class: 'S2' }, { class: 'S1' }] }) === 'S' && raceFamily({ riders: [{ score: 70 }, { score: 72 }] }) === 'C',
    'レースのクラス(S級/A級/チャレンジ)を級班や得点から判断する');
  const s1 = riderToProfile({ score: 102, class: 'S1' }, { family: 'S' }).profile.power, s2 = riderToProfile({ score: 102, class: 'S2' }, { family: 'S' }).profile.power;
  check(s1 > s2, '同じ得点なら、上の班(長い目で見た実力)の選手のほうが強い', `S1 ${s1} > S2 ${s2}`);
  const a3lo = riderToProfile({ score: 66, class: 'A3' }, { family: 'C' }).profile.power, a3hi = riderToProfile({ score: 80, class: 'A3' }, { family: 'C' }).profile.power;
  check(a3hi - a3lo > 0.1 && a3lo > 0.45, 'チャレンジ(A3)の得点差も、地力の差としてちゃんと効く (下限に張り付かない)', `${a3lo} → ${a3hi}`);
  const ex = riderLevel({ score: 96, class: 'A1', history: 'EX_SS' }, 'A'), normal = riderLevel({ score: 96, class: 'A1' }, 'A');
  check(ex.level >= 110 && normal.level < 100, '元SS(北井選手のケース)は、A級を走っていても本来の脚(SS相当)で見る', `元SS ${ex.level} / ふつう ${normal.level}`);
  const up = riderLevel({ score: 98, class: 'S2', history: 'UP' }, 'S'), same = riderLevel({ score: 98, class: 'S2' }, 'S');
  check(up.level < same.level, '昇級したばかりの選手の得点(下のクラスで取ったもの)は割り引く', `${up.level} < ${same.level}`);
  const exA = toRaceSetup({ race: { venue: '小倉' }, lines: [[1, 2, 3], [4, 5], [6, 7]], riders: [
    { car: 1, score: 96, class: 'A1', history: 'EX_SS', style: '逃' }, { car: 2, score: 92, class: 'A1', style: '追' }, { car: 3, score: 84, class: 'A2', style: '追' },
    { car: 4, score: 94, class: 'A1', style: '両' }, { car: 5, score: 91, class: 'A1', style: '追' }, { car: 6, score: 86, class: 'A2', style: '両' }, { car: 7, score: 82, class: 'A2', style: '追' }] });
  const powers = Object.entries(exA.riders).sort((a, b) => b[1].power - a[1].power).map(([c]) => c);
  check(powers[0] === '1' && exA.meta.levels[1].steps.some(x => /本来/.test(x)), 'A級戦の元SSは、出走表の中で一番の地力になり、理由が記録される', powers.join(''));
}

// ---------- 出走表の文字の読み取り ----------
{
  const one = parseRaceCardText(`小倉競輪 11R S級決勝
並び 123/45/67
1 北井 佑季 神奈川 36 119期 S2 逃 104.80 S4 B8
2 山田 太郎 東京 30 S1 追 108.20
3 佐藤 一郎 千葉 S2 追 98.50
4 鈴木 次郎 福岡 SS 両 116.30
5 高橋 三郎 佐賀 S1 追 106.10
6 田中 四郎 大阪 S2 両 101.00
7 伊藤 五郎 京都 S2 追 97.75`);
  const d = one.data;
  check(d.riders.length === 7 && d.riders[0].name === '北井 佑季' && d.riders[0].class === 'S2' && d.riders[0].score === 104.8 && d.riders[0].style === '逃' && d.riders[0].back === 8 && d.riders[0].start === 4,
    '出走表の文字(1行に1人)から、名前・級班・得点・脚質・B・Sを読む', JSON.stringify(d.riders[0]));
  check(JSON.stringify(d.lines) === '[[1,2,3],[4,5],[6,7]]' && d.race.venue === '小倉' && d.race.raceNo === 11 && !validateRaceData(d).length,
    '並び・競輪場・レース番号も読み、そのまま予想できるデータになる', `${JSON.stringify(d.lines)} ${d.race.venue} ${d.race.raceNo}R`);
  const cells = parseRaceCardText('1\n北井 佑季\n神奈川/36/119\nS級2班\n逃\n104.80\n2\n山田太郎\n東京/30/100\nA級1班\n追\n95.10\n←12');
  check(cells.data.riders.length === 2 && cells.data.riders[0].class === 'S2' && cells.data.riders[1].class === 'A1' && cells.data.riders[1].score === 95.1 && JSON.stringify(cells.data.lines) === '[[1,2]]',
    '1項目ずつ改行された書き方・「S級2班」の書き方・「←12」の並びも読める', JSON.stringify(cells.data.riders.map(r => r.class)));
  const zen = parseRaceCardText('１　１　北井佑季　神奈川　Ｓ２　１０４．８０　逃\n２　２　山田太郎　東京　Ｓ１　１０８．２０　追');
  check(zen.data.riders.length === 2 && zen.data.riders[1].score === 108.2 && zen.data.riders[1].class === 'S1', '全角・枠番つきの書き方も読める');
  const girls = parseRaceCardText('ガールズ 5R\n1 児玉碧衣 福岡 L1 両 57.20\n2 山原さくら 高知 L1 追 52.30');
  check(girls.data.race.girls === true && !girls.data.race.venue, 'ガールズを見分け、選手の府県(高知)を競輪場と間違えない');
  const kim = parseRaceCardText('1 北井佑季 S2 104.80 逃 連対時の決まり手 逃げ 19.0% 捲り 23.8% 差し 0.0% マーク 0.0%');
  check(kim.data.riders[0].kimarite?.makuri > kim.data.riders[0].kimarite?.nige, 'WINTICKETの「連対時の決まり手(%)」も読む', JSON.stringify(kim.data.riders[0].kimarite));
  check(kimariteFromPercent(25) === 5, '決まり手の%は、直近およそ20走として回数に直す');
  check(parseRaceCardText('今日は雨').warnings.length > 0, '出走表でない文字なら、読めなかったと知らせる');
}

// ---------- WINTICKET EXデータ (熊本12R 2026-10-24 の形式) ----------
{
  const KUMAMOTO = `競輪場：熊本
レース：12R
レース種別：S級準決勝
車番	選手名	府県	級班
1	嘉永泰斗	熊本	SS
2	菅田壱道	宮城	S1
3	森田優弥	埼玉	S2
4	小原佑太	青森	S1
5	三谷竜生	奈良	S1
6	西岡利起	奈良	S2
7	中川誠一郎	熊本	S1
8	東矢圭吾	熊本	S1
9	宿口陽一	埼玉	S1

4. WINTICKET EXデータ：戦法別
車番	かまし成功率	突っ張り成功率	ちぎり率	ちぎられ率	飛びつき成功率
1	50% (1/2)	100% (1/1)	25% (4/16)	0% (0/4)	—
2	—	100% (2/2)	0% (0/6)	8% (2/25)	100% (1/1)
3	100% (5/5)	100% (3/3)	21% (7/33)	—	100% (2/2)
4	83% (10/12)	85% (6/7)	20% (6/30)	0% (0/1)	—
5	100% (1/1)	71% (5/7)	10% (2/19)	0% (0/6)	100% (1/1)
6	60% (3/5)	42% (3/7)	10% (3/30)	—	—
7	—	—	0% (0/1)	10% (2/20)	—
8	50% (2/4)	57% (4/7)	19% (4/21)	0% (0/2)	—
9	—	—	—	3% (1/28)	—

5. WINTICKET EXデータ：ライン先頭時
車番	1着	2着	3着	着外
1	27% (15/55)	12% (7/55)	7% (4/55)	52% (29/55)
2	30% (12/39)	15% (6/39)	15% (6/39)	38% (15/39)
3	36% (28/77)	15% (12/77)	12% (10/77)	35% (27/77)
4	13% (11/84)	13% (11/84)	13% (11/84)	60% (51/84)
5	19% (12/63)	15% (10/63)	4% (3/63)	60% (38/63)
6	26% (23/86)	20% (18/86)	11% (10/86)	40% (35/86)
7	18% (2/11)	9% (1/11)	9% (1/11)	63% (7/11)
8	16% (12/75)	12% (9/75)	17% (13/75)	54% (41/75)
9	25% (1/4)	0% (0/4)	25% (1/4)	50% (2/4)

6. WINTICKET EXデータ：番手時
車番	1着	2着	3着	着外
1	50% (4/8)	25% (2/8)	0% (0/8)	25% (2/8)
2	36% (15/41)	9% (4/41)	12% (5/41)	41% (17/41)
3	—	—	—	—
4	100% (2/2)	0% (0/2)	0% (0/2)	0% (0/2)
5	30% (6/20)	10% (2/20)	20% (4/20)	40% (8/20)
6	—	—	—	—
7	30% (13/42)	14% (6/42)	9% (4/42)	45% (19/42)
8	33% (1/3)	0% (0/3)	33% (1/3)	33% (1/3)
9	18% (14/74)	20% (15/74)	10% (8/74)	50% (37/74)

7. WINTICKET EXデータ：400mバンク
車番	1着	2着	3着	着外
1	28% (18/63)	14% (9/63)	6% (4/63)	50% (32/63)
4	18% (13/72)	12% (9/72)	12% (9/72)	56% (41/72)`;
  const ex = parseExData(KUMAMOTO);
  check(ex[4]?.tactics.tsuppari?.s === 6 && ex[4].tactics.tsuppari.n === 7 && ex[2].tactics.kamashi === null && ex[9].tactics.tsuppari === null && ex[5].tactics.chigirare?.n === 6,
    'EXデータ(戦法別)を、割合だけでなく 分子/分母 で読み、「—」はデータなし(0と区別)にする', JSON.stringify(ex[4].tactics.tsuppari));
  check(ex[4]?.finish.asLeader?.n === 84 && ex[9]?.finish.asBante?.w?.s === 14 && ex[3]?.finish.asBante?.n === 0 && ex[1]?.finish.bank400?.n === 63,
    'EXデータ(ライン先頭時・番手時・400mバンク)の着順を、表のタイトルで見分けて読む');
  check(styleFromEx(ex[3]) === '逃' && styleFromEx(ex[2]) === '両' && styleFromEx(ex[9]) === '追', '脚質が分からないときは、先頭と番手で走った回数から自力型か追込型かを見る');
  const t4 = exTendencies(ex[4]), t3 = exTendencies(ex[3]);
  check(t3.tsuppariSuccess < 0.9 && t4.tsuppariFreq > exTendencies(ex[1]).tsuppariFreq, '試行回数が少ない100%(3/3)は過大評価しない。突っ張りの回数が多い選手ほど突っ張りやすい',
    `3番の突っ張り成功 ${t3.tsuppariSuccess.toFixed(2)} / 突っ張り傾向 4番${t4.tsuppariFreq.toFixed(2)} > 1番${exTendencies(ex[1]).tsuppariFreq.toFixed(2)}`);
  const p4 = frontPlanProbs('逃', ex[4]), p9 = frontPlanProbs('追', ex[9]);
  check(Math.abs(p4.TSUPPARI + p4.HIKU + p4.CHUDAN - 1) < 0.02 && p4.TSUPPARI > p9.TSUPPARI && p4.HIKU > p4.CHUDAN && p9.CHUDAN > p9.HIKU,
    '前受けの動きの割合: 突っ張りの多い先行型は突っ張り・引くが多く、追込型は中団を取る', `4番 ${JSON.stringify(p4)} / 9番 ${JSON.stringify(p9)}`);
  const parsed = parseRaceCardText(KUMAMOTO);
  const groups = parsed.data.lines.map(l => l.join('')).sort().join(' ');
  check(parsed.found.ex === 9 && parsed.found.linesPredicted && groups === '39 42 65 817' && parsed.data.race.venue === '熊本' && parsed.data.race.kind === 'semifinal',
    '並びが無ければ、AIが地区と先行度から並びを予想する (熊本の実際の並び 8-1-7 / 4-2 / 3-9 / 6-5)', groups);
  const s = toRaceSetup(parsed.data);
  check(s.riders[4].frontPlan && s.riders[4].frontPlanProbs && s.meta.conversion[4].some(x => x.startsWith('EX:')) && s.riders[2].followAllowance < s.riders[1].followAllowance,
    'EXデータが能力と作戦に反映される (前受けの動き・ちぎられ率→付いていける速さ)、根拠も残る', `2番 ${s.riders[2].followAllowance} < 1番 ${s.riders[1].followAllowance}`);
  const legacy = toRaceSetup({ ...SAMPLE_RACE_DATA, frontResponse: { 1: 'YIELD' } });
  check(legacy.riders[1].frontResponse === 'CHUDAN', '前の版の「出させる」の指定は「中団」として読む');
  const wt = parseRaceCardText(`枠 車 選手名 AI 競走得点 S H B 脚 逃
1 1 嘉永泰斗 熊本 SS 28歳 113期 114.33 3 2 5 逃 1
2 2 菅田壱道 宮城 S1 40歳 91期 115.63 10 0 1 両 0`);
  check(wt.data.riders[0].score === 114.33 && wt.data.riders[0].start === 3 && wt.data.riders[0].back === 5 && wt.data.riders[1].style === '両' && wt.data.riders[0].pref === '熊本',
    'WINTICKETの基本情報の書き方(得点のあとに S H B が数字だけ)も読める', JSON.stringify(wt.data.riders[0]));
}

// ---------- 前受けの動き (突っ張る / 引く / 中団) が、実際のレースでそのとおりに起きる ----------
{
  const { forecastRaces } = await import('./forecast.js');
  const base = () => ({ race: { venue: '小倉' }, lines: [[1, 2, 3], [4, 5], [6, 7]], riders: [
    { car: 1, score: 110, style: '逃', back: 8 }, { car: 2, score: 108, style: '追' }, { car: 3, score: 104, style: '追' },
    { car: 4, score: 109, style: '両' }, { car: 5, score: 106, style: '追' }, { car: 6, score: 111, style: '逃', back: 10 }, { car: 7, score: 105, style: '追' }] });
  const story = front => { const d = base(); d.frontResponse = { 1: front }; const e = new PhysicsEngine(toRaceSetup(d)); e.start();
    for (let t = 0; t < 150 && !e.riders.every(r => r.finished); t += 1 / 60) e.update(1 / 60);
    return { text: e.getStory().story.map(x => x.text).join(' '), e }; };
  const hiku = story('HIKU'), chudan = story('CHUDAN'), tsu = story('TSUPPARI');
  const bellOrder = x => x.e.recorder.snapshots.bell?.order ?? [];
  check(/後方まで引いて/.test(hiku.text) && bellOrder(hiku).indexOf(1) > bellOrder(hiku).indexOf(4), '「引く」: 前受けが誘導切りを前に入れて、後方まで下げる (打鐘で中団のラインより後ろ)', bellOrder(hiku).join(''));
  check(/中団を取る/.test(chudan.text) && bellOrder(chudan).indexOf(1) < bellOrder(chudan).indexOf(4), '「中団」: 前受けが誘導切りを前に入れて、その後ろを取る (打鐘で中団)', bellOrder(chudan).join(''));
  check(/突っ張/.test(tsu.text), '「突っ張る」: 前受けが誘導切りに来た相手を突っ張る');
  // EXデータがある選手は、何通りもの未来で 突っ張る / 引く / 中団 を割合で選び、本線・対抗・波乱が展開ごとに分かれる
  const d = base(); d.riders[0].score = 115; d.riders[0].ex = { tactics: { tsuppari: { s: 5, n: 7 }, kamashi: { s: 3, n: 5 } }, finish: { asLeader: { n: 60, w: { s: 12, n: 60 }, p2: { s: 8, n: 60 }, p3: { s: 6, n: 60 } }, asBante: { n: 3, w: { s: 1, n: 3 }, p2: null, p3: null } } };
  const f = forecastRaces(toRaceSetup(d), 24);
  const themes = f.scenarios.map(x => x.theme);
  check(themes.length >= 2 && themes.every(t => /番ラインが主導権/.test(t)) && new Set(themes).size === themes.length, '本線・対抗・波乱は「どのラインが主導権を取るか」で分かれ、展開の名前が付く', themes.join(' / '));
}

// ---------- 展開ごとの買い目アドバイス (3連単) ----------
{
  const { buildAdvice, groupedKeys, adviceText } = await import('./advice.js');
  const mk = (orders, mainLine = 1) => orders.map(o => ({ order: o, mainLine, how: '差し', ev: { chigire: [], kamashi: [], makuri: [], banteMakuriBy: [] } }));
  const firm = mk(Array.from({ length: 20 }, (_, i) => (i < 16 ? [1, 2, 3, 4, 5, 6, 7] : [2, 1, 3, 4, 5, 6, 7])));
  const af = buildAdvice({ runs: firm, scenario: { mainLine: 1 }, marks: { 1: '◎', 2: '○', 3: '▲' } });
  check(af.points >= 3 && af.points <= 6 && af.difficulty === '固い' && af.honmei[0].key === '1-2-3', '固い展開は少ない点数 (本命が先頭に来る)', `${af.points}点 ${af.honmei.map(x => x.key).join(' ')}`);
  let rs = 3; const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const wild = mk(Array.from({ length: 30 }, () => [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rnd() - .5)));
  const aw = buildAdvice({ runs: wild, scenario: { mainLine: 1 }, marks: { 1: '◎', 2: '○', 3: '▲' } });
  check(aw.points > af.points && aw.points <= 24 && aw.difficulty === '荒れそう', '荒れる展開ほど点数が増える (最大24点)', `${aw.points}点`);
  check(aw.ana.every(x => x.key.split('-').slice(0, 2).some(c => !['1', '2', '3'].includes(c))), '波乱は、印の薄い選手が1・2着に絡む組み合わせ');
  check(JSON.stringify(groupedKeys([{ key: '2-4-9' }, { key: '2-4-5' }, { key: '3-4-9' }])) === '["2-4-9,5","3-4-9"]' && /本命: 1-2-3/.test(adviceText(af)),
    '買い目は1・2着が同じものをまとめて書く (例 2-4-9,5)、コピー用の文字も作れる');
  const thin = buildAdvice({ runs: [...firm, ...mk([[3, 4, 5, 1, 2, 6, 7]], 3)], scenario: { mainLine: 3 }, marks: {} });
  check(thin.thin && thin.notes.length === 0, 'その展開になった回が少ないときは「参考程度」とし、起きそうなことは出さない');
  const { forecastRaces } = await import('./forecast.js');
  const f = forecastRaces(toRaceSetup({ ...SAMPLE_RACE_DATA }), 12);
  check(f.marks[f.scenarios[0].order[0]] === '◎' && f.marks[f.scenarios[0].order[1]] === '○' && f.runs.length === 12, '印は本線に合わせる (◎=本線の1着、○=2着)', JSON.stringify(f.marks));
}

// ---------- 「1番車 名前 府県 … 競走得点…」の出走表 + 【周回予想ライン】 + 【今開催成績】 ----------
{
  const r = parseRaceCardText(`2026年10月25日 熊本競輪 8R
S級特選 9車立て 発走14:16
距離2025m 5周 熊本400mバンク
【出走表】
1番車 山田一郎 岐阜 26歳 123期 S2 逃 競走得点107.00 勝率27.59% 直近29走8-8-2-11 決まり手逃14捲0差1マ1 S7 B16 コメント:自力。
2番車 田中二郎 大分 30歳 117期 S1 逃 競走得点108.32 決まり手逃1捲4差2マ1 S9 B6 コメント:佐藤君。
3番車 鈴木三郎 群馬 36歳 100期 S1 追 競走得点108.07 決まり手逃0捲1差5マ2 S7 B0
4番車 佐藤四郎 新潟 23歳 125期 S2 逃 競走得点101.35 決まり手逃2捲0差2マ0 S1 B7
5番車 高橋五郎 徳島 27歳 117期 S2 逃 競走得点104.93 決まり手逃4捲9差1マ1 S2 B7
6番車 伊藤六郎 山口 37歳 96期 S2 追 競走得点96.74 決まり手逃0捲0差1マ3 S2 B0
7番車 渡辺七郎 熊本 23歳 123期 S2 逃 競走得点103.48 決まり手逃5捲5差1マ0 S0 B13
8番車 中村八郎 東京 45歳 90期 S2 追 競走得点98.64 決まり手逃0捲0差3マ3 S2 B0
9番車 小林九郎 岐阜 33歳 103期 S2 両 競走得点106.57 決まり手逃0捲3差4マ3 S6 B0
【周回予想ライン】
1-9（山田-小林）
7-2（渡辺-田中）
4-3-8（佐藤-鈴木-中村）
5-6（高橋-伊藤）
【今開催成績】
1 山田：一次予選2着 二次予選4着 準決勝7着
9 小林：一次予選1着 二次予選5着 特選6着`);
  const d = r.data, byCar = Object.fromEntries(d.riders.map(x => [x.car, x]));
  check(d.riders.length === 9 && byCar[1].name === '山田一郎' && byCar[2].score === 108.32 && byCar[2].class === 'S1' && byCar[4].start === 1 && byCar[4].back === 7 && byCar[9].style === '両' && byCar[1].kimarite?.nige === 14,
    '「1番車 名前 … 競走得点107.00 … S7 B16」の書き方を読む (「9車立て」「5周」を選手と間違えない・「S1 B7」はS回数)', d.riders.map(x => `${x.car}${x.name}`).join(' '));
  check(JSON.stringify(d.lines) === '[[1,9],[7,2],[4,3,8],[5,6]]' && d.race.venue === '熊本' && d.race.raceNo === 8 && !r.found.linesPredicted,
    '【周回予想ライン】の「1-9（山田-小林）」を1行1ラインで読む', JSON.stringify(d.lines));
  check(byCar[1].meet?.map(x => x.pos).join('') === '247' && byCar[9].meet?.length === 3 && /今開催 2-4-7着/.test(toRaceSetup(d).meta.conversion[1].join(' ')),
    '【今開催成績】の着順を読み、選手の見立てに出す', JSON.stringify(byCar[1].meet));
}

// ---------- 文章で書いた展開を読み取る (競輪の言葉の辞書) ----------
{
  const { parseTenkaiText, applyTenkai } = await import('./tenkai-text.js');
  const d = { race: { venue: '熊本' }, lines: [[1, 9], [7, 2], [4, 3, 8], [5, 6]], riders: [
    { car: 1, name: '棚瀬義大', pref: '岐阜', score: 107, style: '逃' }, { car: 2, name: '阿部将大', pref: '大分', score: 108.32, style: '逃' },
    { car: 3, name: '恩田淳平', pref: '群馬', score: 108.07, style: '追' }, { car: 4, name: '渡邉壘', pref: '新潟', score: 101.35, style: '逃' },
    { car: 5, name: '久田裕也', pref: '徳島', score: 104.93, style: '逃' }, { car: 6, name: '山下一輝', pref: '山口', score: 96.74, style: '追' },
    { car: 7, name: '佐藤壮志', pref: '熊本', score: 103.48, style: '逃' }, { car: 8, name: '朝倉佳弘', pref: '東京', score: 98.64, style: '追' },
    { car: 9, name: '長尾拳太', pref: '岐阜', score: 106.57, style: '両' }] };
  const P = t => parseTenkaiText(t, d).changes;
  const cases = [
    ['佐藤が打鐘でカマす', c => c.tactics[7] === 'KAMASHI' && c.tenkai[7].strike === 600],
    ['ジャンで⑦が叩いて主導権', c => c.tactics[7] === 'SENKO' && c.tenkai[7].strike === 600],
    ['棚瀬は引いて巻き返し', c => c.frontResponse[1] === 'HIKU'],
    ['棚瀬は出させない', c => c.frontResponse[1] === 'TSUPPARI'],
    ['佐藤は引かない', c => c.frontResponse[7] === 'TSUPPARI'],
    ['5番はロング捲り', c => c.tactics[5] === 'MAKURI' && c.tenkai[5].strike >= 400],
    ['久田が4角から捲り追い込み', c => c.tactics[5] === 'MAKURI' && c.tenkai[5].strike === 100],
    ['長尾君がバックで番手捲り', c => c.tenkai[9].banteMakuri === 200],
    ['ハコの長尾は前を見捨てる', c => c.tenkai[9]?.banteMakuri != null],
    ['九州ラインが前受け', c => c.formationMoves[0]?.line[0] === 7 && c.formationMoves[0].to === 'FRONT'],
    ['渡邉ラインは赤板で誘導切り', c => c.tenkai[4].cutPacer === true],
    ['阿部は5番に切り替え', c => c.tenkai[2].switchTo === 5],
    ['関東の3番手はマーク', c => true],
    ['二段駆けで1-9', c => c.tactics[1] === 'SENKO' && c.tenkai[9].banteMakuri != null],
    ['九州の番手はブロックしない', c => c.tenkai[2].noBlock === true],
    ['久田はカマさず捲りに構える', c => c.tactics[5] === 'MAKURI'],
    ['棚瀬と佐藤がもがき合い', c => c.tactics[1] === 'SENKO' && c.tactics[7] === 'SENKO'],
    ['1番は残り300mから仕掛け', c => c.tenkai[1].strike === 300],
    ['並び 72 19 438 56', c => JSON.stringify(c.lines) === '[[7,2],[1,9],[4,3,8],[5,6]]']
  ];
  const bad = cases.filter(([t, f]) => { try { return !f(P(t)); } catch { return true; } }).map(([t]) => t);
  check(!bad.length, `文章の展開を競輪の言葉で読み取る (${cases.length}通りの言い回し)`, bad.length ? `読めなかった: ${bad.join(' / ')}` : `${cases.length}通りすべて`);
  const r = parseTenkaiText('棚瀬が逃げ切る。3番が千切れる', d);
  check(!Object.keys(r.changes.tactics).length && r.outcomes.length === 2, '「逃げ切る」「千切れる」のような結果の言葉は、展開の指定にしない', r.outcomes.join(' / '));
  const applied = applyTenkai(d, P('佐藤が打鐘でカマす。長尾がバックで番手捲り。九州ラインが前受け'));
  const setup = toRaceSetup(applied);
  check(!validateRaceData(applied).length && setup.riders[7].tactic === 'KAMASHI' && setup.riders[7].strikeRem === 600 && setup.riders[9].banteMakuriAt === 200 && setup.formation[0][0] === 7,
    '読み取った展開が、そのままレースの設定 (戦法・仕掛けどころ・番手捲り・周回の並び) になる', JSON.stringify(setup.formation));
}

// ---------- 予想のリンク共有: 短く圧縮しても、出走表・並び・展開の指定がそのまま戻る ----------
{
  const { encodeRaceData, decodeRaceData } = await import('./race-input.js');
  const d = structuredClone(SAMPLE_RACE_DATA);
  d.lines = [[7, 8, 9], [1, 2, 3], [4, 5, 6]]; d.tactics = { 4: 'KAMASHI' }; d.frontResponse = { 7: 'TSUPPARI' };
  d.riders[0].meet = [{ stage: '一次予選', pos: 2 }, { stage: '準決勝', pos: 7 }];
  const code = await encodeRaceData(d), back = await decodeRaceData(code);
  const legacy = await decodeRaceData(Buffer.from(JSON.stringify(d)).toString('base64url'));
  check(JSON.stringify(back.lines) === JSON.stringify(d.lines) && back.tactics[4] === 'KAMASHI' && back.frontResponse[7] === 'TSUPPARI' && back.riders[0].name === d.riders[0].name
    && back.riders[0].score === d.riders[0].score && back.riders[0].meet.map(m => m.pos).join('') === '27' && !validateRaceData(back).length && legacy.riders.length === 9
    && code.length < Buffer.from(JSON.stringify(d)).toString('base64url').length / 3,
  '共有リンクは短く圧縮しても、出走表・並び・展開の指定がそのまま戻る (以前の長いリンクも開ける)', `${code.length}文字 (以前の書き方なら${Buffer.from(JSON.stringify(d)).toString('base64url').length}文字)`);
}

// ---------- 答え合わせの採点 (確定した予想 → 結果) ----------
{
  const { makeLock, scoreLock, summarize, fingerprint } = await import('./scoring.js');
  const { forecastRaces } = await import('./forecast.js');
  const { buildAdvice } = await import('./advice.js');
  const setup = toRaceSetup(SAMPLE_RACE_DATA);
  const f = forecastRaces(setup, 12);
  const adv = buildAdvice({ runs: f.runs, scenario: f.scenarios[0], marks: f.marks });
  const lock = makeLock({ setup, forecast: f, advice: adv, now: new Date('2026-10-25T10:00:00Z') });
  check(lock.orders.length === 12 && lock.main.length === 3 && lock.fingerprint === fingerprint(setup) && JSON.stringify(lock).length < 20000,
    '予想を確定すると、本線・印・買い目・未来の着順が小さく保存される', `${JSON.stringify(lock).length}文字`);
  const hit = scoreLock(lock, lock.main), miss = scoreLock(lock, [...lock.cars].reverse().slice(0, 3));
  check(hit.trifectaHit && hit.p > miss.p && hit.vsRandom > 1 && hit.logLoss < miss.logLoss && hit.adviceHit === '本命',
    '本線どおりの結果は、確率が高く当てずっぽうより良い採点になる (買い目は本命で的中)', `本線 ${(hit.p * 100).toFixed(1)}% ${hit.vsRandom.toFixed(1)}倍 / 外れ ${(miss.p * 100).toFixed(2)}%`);
  // 全組み合わせの確率の合計は1 (どの結果でも採点できる)
  const { buildModel, trifectaTable } = await import('./prob.js');
  const total = trifectaTable(buildModel(lock.orders, lock.cars), lock.cars).reduce((a, x) => a + x.p, 0);
  check(Math.abs(total - 1) < 1e-9, '3連単の確率は全組み合わせで合計1', total.toFixed(6));
  const s = summarize([{ ...lock, result: hit }, { ...lock, result: miss }, { ...lock }]);
  check(s.n === 2 && Math.abs(s.vsRandom - Math.sqrt(hit.vsRandom * miss.vsRandom)) < 1e-9, '通算は採点済みの確定予想だけ・当てずっぽうとの比は掛け算の平均', `${s.n}レース ${s.vsRandom.toFixed(2)}倍`);
}

// ---------- 過去のレースでまとめて答え合わせ・展開のひな形 ----------
{
  const { splitBatchText, prepareRace, scoreForecast, summarizeBatch, stripUserReads } = await import('./batch.js');
  const { forecastRaces } = await import('./forecast.js');
  const { templates } = await import('./tactics-panel.js');
  const { parseTenkaiText } = await import('./tenkai-text.js');
  const card = `小倉競輪 9R
1 棚瀬義大 S1 岐阜 101.20 逃
2 佐藤一伸 S2 福島 98.50 両
3 中村浩士 S1 千葉 99.10 追
4 久田裕也 S1 徳島 104.30 逃
5 小倉竜二 S2 徳島 97.80 追
6 長尾拳太 S2 岐阜 98.20 追
7 和田健太郎 S1 千葉 100.40 追
並び 16/23/45/7`;
  const text = `${card}\n展開: 久田が打鐘でカマす\n結果: 4-5-1\n${card.replace('9R', '10R')}\n３連単 ７－４－５\n${card.replace('9R', '11R')}\n結果 4-8-1\nメモ`;
  const blocks = splitBatchText(text);
  check(blocks.length === 3 && blocks[0].actual.join('') === '451' && blocks[0].tenkaiText && blocks[1].actual.join('') === '745' && !blocks[1].tenkaiText,
    'まとめて貼った出走表を、結果の行でレースごとに分け、展開の文章と結果を取り出す', blocks.map(b => b.actual?.join('-')).join(' / '));
  const sep = splitBatchText(`結果 1-2-3\n${card}\n---\n${card}\n結果: 4-5-1`);
  check(sep.length === 2 && sep[0].actual.join('') === '123', '「---」で区切れば、結果の行がレースの頭にあっても読める');
  const [r1, r2, r3] = blocks.map(prepareRace);
  check(r1.ok && r1.mineSetup && r2.ok && !r2.mineSetup && !r3.ok && /合いません/.test(r3.error),
    '展開を書いたレースは「読み入り」も作り、車番に無い結果は理由を出してはじく', r3.error);
  const ai = scoreForecast(r1.aiSetup, forecastRaces(r1.aiSetup, 8), r1.actual);
  const mine = scoreForecast(r1.mineSetup, forecastRaces(r1.mineSetup, 8), r1.actual);
  const sum = summarizeBatch([{ ai, mine }, { ai }, { label: 'x', error: 'e' }]);
  check(sum.n === 2 && sum.mine?.n === 1 && ai.p > 0 && Math.abs(sum.vsRandom - ai.vsRandom) < 1e-9, 'まとめの数字は採点できたレースだけで、読み入りは別に比べる', `${(ai.p * 100).toFixed(1)}% → 読み入り ${(mine.p * 100).toFixed(1)}%`);
  check(stripUserReads({ ...SAMPLE_RACE_DATA, tactics: {}, frontResponse: {}, tenkai: {} }) === null && stripUserReads({ ...SAMPLE_RACE_DATA, tactics: { 1: 'KAMASHI' } })?.tactics?.[1] == null,
    '読みを入れていない予想は比べず、入れた予想からは読みを抜いたAIだけの出走表を作る');
  const data = r1.aiData;
  const tps = templates(data);
  const bad = tps.filter(t => { const r = parseTenkaiText(t.text, data); return !r.readings.length || r.unknown.length; });
  check(tps.length >= 6 && !bad.length, '展開のひな形はこのレースの選手名で作られ、どれもそのまま読み取れる', `${tps.map(t => t.label).join('・')}${bad.length ? ` / 読めない: ${bad.map(t => t.text).join(' ')}` : ''}`);
  const tobi = parseTenkaiText('和田は久田の番手に飛びつき', data);
  check(data.tenkai == null && tobi.changes.tenkai[7]?.tobitsuki === 4, '「久田の番手に飛びつく」は、久田の後ろ (番手の位置) を取りに行く');
}

// ---------- 用語の説明 ----------
{
  const { TERMS, linkTerms, guideHtml } = await import('./glossary.js');
  const badSee = Object.entries(TERMS).flatMap(([k, t]) => (t.see ?? []).filter(x => !TERMS[x]).map(x => `${k}→${x}`));
  check(!badSee.length && Object.keys(TERMS).length >= 40, '用語集: 40語以上、関連の言葉もすべて説明がある', badSee.join(' ') || `${Object.keys(TERMS).length}語`);
  const seen = new Set();
  const html = linkTerms('赤板で7番が誘導切り。打鐘で番手から差し。<b>', seen);
  check(/data-term="赤板"/.test(html) && /data-term="誘導切り"/.test(html) && /data-term="差し"/.test(html) && html.includes('&lt;b&gt;') && !/data-term="番手捲り"/.test(html),
    '文章の中の用語はタップできる形になり、それ以外の文字はそのまま (HTMLとして混ざらない)');
  check(linkTerms('赤板と赤板', new Set()).split('data-term').length === 2, '同じ用語の説明リンクは最初の1回だけ (下線だらけにしない)');
  check(guideHtml().includes('レースの流れ') && guideHtml().includes('data-term='), '「競輪の基本」は用語のリンク付きで読める');
}

console.log(failures ? `\n${failures}件 失敗` : '\nすべて合格');
process.exit(failures ? 1 : 0);
