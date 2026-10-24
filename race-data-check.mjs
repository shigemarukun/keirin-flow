// KEIRIN FLOW — 出走表(レースデータ)の変換テスト
import { toRaceSetup, validateRaceData, parseLines, riderToProfile, SAMPLE_RACE_DATA, normalizeClass, raceFamily, riderLevel, parseRaceCardText, kimariteFromPercent } from './race-data.js';
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

console.log(failures ? `\n${failures}件 失敗` : '\nすべて合格');
process.exit(failures ? 1 : 0);
