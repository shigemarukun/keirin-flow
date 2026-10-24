// KEIRIN FLOW — 出走表(レースデータ)の変換テスト
import { toRaceSetup, validateRaceData, parseLines, riderToProfile, SAMPLE_RACE_DATA } from './race-data.js';
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

console.log(failures ? `\n${failures}件 失敗` : '\nすべて合格');
process.exit(failures ? 1 : 0);
