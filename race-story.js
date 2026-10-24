// KEIRIN FLOW — レースの記録と、展開の文章づくり
//
// RaceRecorder: シミュレーション中の要所 (赤板・打鐘・最終ホーム・バック・最終直線) で隊列を記録する
// buildStory:   記録と Decision Log から、人が読む「展開の文章」と決まり手を組み立てる
//
// どちらも車番やラインIDの決め打ちはしない。記録された位置と判断だけを使う。

export const CHECKPOINTS = Object.freeze([
  { key: 'akaban', remaining: 770, label: '赤板' },
  { key: 'bell', remaining: 600, label: '打鐘' },
  { key: 'home', remaining: 400, label: '最終ホーム' },
  { key: 'back', remaining: 200, label: 'バック' },
  { key: 'corner4', remaining: 110, label: '4コーナー手前' },
  { key: 'straight', remaining: 55, label: '最終直線' }
]);

// ログの残り距離を、400バンクに直して使う (333・500バンクでも同じ基準で展開を書く)
const R = l => l.rem400 ?? l.remaining;

export class RaceRecorder {
  constructor() { this.reset(); }
  reset() { this.snapshots = {}; }
  observe(engine) {
    const rem = engine.raceClock.remainingDistance / (engine.lapScale ?? 1); // 400バンクに直した残り距離
    for (const cp of CHECKPOINTS) {
      if (this.snapshots[cp.key] || rem > cp.remaining) continue;
      // 競り負けて下げている選手は、もう前の隊列ではないので後ろに回して記録する
      const back = r => (r.action === 'RETREAT' || engine.rider(r.leaderNumber)?.action === 'RETREAT') ? 1 : 0;
      const order = [...engine.riders].filter(r => !r.finished).sort((a, b) => (back(a) - back(b)) || (b.distance - a.distance));
      this.snapshots[cp.key] = {
        remaining: rem,
        order: order.map(r => r.number),
        lanes: Object.fromEntries(order.map(r => [r.number, r.laneOffset])),
        energy: Object.fromEntries(order.map(r => [r.number, r.energy]))
      };
    }
  }
}

// ---------- 決まり手 ----------
// 逃げ: バックと直線入口(4コーナー出口・残り約55m)で先頭、そのまま1着 (捲って先頭に立った選手は除く)
// 捲り: バックでは先頭ではなく、直線入口までに先頭を奪って1着 (番手捲りも含む)
// 差し: 直線入口で先頭ではなく、直線で前を抜いて1着
// マーク: (2着・3着) 同じラインで前を走っていた選手のすぐ後ろでゴール
export function kimarite(snapshots, ranking, frontMateOf, logs = []) {
  const winner = ranking[0]?.number;
  if (winner == null) return null;
  const leadAt = key => snapshots[key]?.order?.[0];
  const posAtBack = snapshots.back?.order?.indexOf(winner) ?? -1;
  let winnerHow;
  // 先頭のまま押し切っても、捲って先頭に立った選手は「捲り」
  const madeMakuri = logs.some(l => l.riderNumber === winner && R(l) <= 600 && /捲りに出る|番手捲り/.test(l.message));
  if (leadAt('straight') === winner && leadAt('back') === winner && (leadAt('home') === winner || !madeMakuri)) winnerHow = '逃げ';
  else if (leadAt('straight') === winner && posAtBack !== 0) winnerHow = '捲り'; // 直線に入るまでに先頭を奪った (番手捲りも含む)
  else winnerHow = '差し';
  // マーク: ラインで自分のすぐ前を走っていた選手の、すぐ後ろの着順でゴール
  const marks = [];
  for (let i = 1; i < Math.min(3, ranking.length); i++) {
    const n = ranking[i].number, prev = ranking[i - 1].number;
    if (frontMateOf(n) === prev) marks.push(n);
  }
  return { winner, how: winnerHow, marks };
}

// ---------- 展開の文章 ----------
const fmtOrder = (order, lineOf) => fmtLines(order, lineOf);
// 競輪の並びの書き方: ラインごとにまとめ、そのラインの一番前の選手の位置順に並べる (例: 789 123 456)
let lineMembers = () => [];
const fmtLines = (order, lineOf) => {
  const seen = new Set(), out = [];
  for (const n of order ?? []) {
    const id = lineOf(n);
    if (!id) { out.push(String(n)); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(lineMembers(id).filter(m => order.includes(m)).join('')); // ライン内は並びの順で書く
  }
  return out.join(' ');
};
const fmtOrderRaw = (order, lineOf) => {
  // 同じラインが続けてくっついているところを「123」のようにまとめ、ラインの切れ目を空白で区切る
  const groups = [];
  for (const n of order ?? []) {
    const last = groups[groups.length - 1];
    if (last && lineOf(n) && lineOf(n) === lineOf(last[last.length - 1])) last.push(n);
    else groups.push([n]);
  }
  return groups.map(g => g.join('')).join(' ');
};

const firstLog = (logs, test) => logs.find(test);
const between = (log, hi, lo) => R(log) <= hi && R(log) > lo;

export function buildStory({ setup, prediction, snapshots, logs, ranking, names = {} }) {
  const lineOf = n => setup.lines.find(l => l.members.includes(n))?.id ?? null;
  lineMembers = id => setup.lines.find(l => l.id === id)?.members ?? [];
  const name = n => (names[n] ? `${n}番${names[n]}` : `${n}番`);
  const story = [];
  const add = (phase, text) => { if (text) story.push({ phase, text }); };
  const riderLogs = logs.filter(l => l.riderNumber != null);

  // スタートの隊列
  const formation = (setup.formation?.length ? setup.formation : setup.lines.map(l => l.members)).map(g => g.join('')).join(' ');
  add('周回', `${setup.rules?.girls ? 'ガールズ (ラインなしの個人戦)。' : ''}スタートは ${formation} の並び。${prediction?.initialFrontLeaderNumber != null ? `${name(prediction.initialFrontLeaderNumber)}が前受け。` : ''}`);

  // 赤板〜打鐘: 誘導切り
  const cutStart = firstLog(riderLogs, l => /誘導切りへ外を上昇/.test(l.message));
  const tsuppari = firstLog(riderLogs, l => /突っ張る/.test(l.message) && R(l) > 500);
  const yielded = firstLog(riderLogs, l => /(誘導切りを受け入れる|出させて一旦引く)/.test(l.message));
  const cutLost = firstLog(riderLogs, l => /踏み合いで.*競り負け/.test(l.message) && R(l) > 500);
  const cutWon = firstLog(riderLogs, l => /踏み合いを制して.*叩き切る/.test(l.message) && R(l) > 500);
  if (cutStart) {
    let t = `赤板で${name(cutStart.riderNumber)}が外から誘導切りへ。`;
    if (tsuppari && cutLost) t += `${name(tsuppari.riderNumber)}が突っ張り、${name(cutLost.riderNumber)}は踏み合いで競り負けて後方へ下げる。`;
    else if (tsuppari && cutWon) t += `${name(tsuppari.riderNumber)}が突っ張るが、${name(cutWon.riderNumber)}が踏み勝って前に出る。`;
    else if (yielded) t += `${name(yielded.riderNumber)}は無理に張り合わず、${cutStart.riderNumber}番${lineOf(cutStart.riderNumber) ? 'のライン' : ''}を前に入れる。`;
    add('赤板', t);
  }
  if (snapshots.bell) add('打鐘', `打鐘の隊列は ${fmtOrder(snapshots.bell.order, lineOf)}。`);

  // 打鐘〜最終ホーム: 主導権
  const strikes = riderLogs.filter(l => R(l) <= 600 && R(l) > 110 && (/主導権を握って先行|叩いて主導権|カマす|捲りに出る|番手捲り/.test(l.message)));
  const seen = new Set();
  for (const s of strikes) {
    if (seen.has(s.riderNumber)) continue;
    seen.add(s.riderNumber);
    const where = R(s) > 400 ? '打鐘過ぎ' : R(s) > 200 ? '最終ホーム〜2コーナー' : 'バック〜3コーナー';
    let what = '';
    if (/カマす/.test(s.message)) what = '後方から一気にカマす';
    else if (/叩いて主導権/.test(s.message)) what = '前を叩いて主導権を取りにいく';
    else if (/主導権を握って先行/.test(s.message)) what = '先頭で踏み上げて先行';
    else if (/番手捲り/.test(s.message)) what = '番手から自分で捲って出る';
    else what = '外から捲りに出る';
    add(where, `${name(s.riderNumber)}が${what}。`);
    if (seen.size >= 4) break;
  }
  const blocks = riderLogs.filter(l => l.action === 'BLOCK' && R(l) <= 400);
  if (blocks.length) {
    const b = blocks[0];
    const target = b.message.match(/(\d)番の/)?.[1];
    add('攻防', `${name(b.riderNumber)}が番手から${target ? `${target}番の` : ''}捲りを外へ張ってブロック。`);
  }
  const contest = firstLog(riderLogs, l => /秒の踏み合い/.test(l.message) && R(l) <= 500);
  if (contest) add('攻防', contest.message.replace(/\s*\(残脚.*\)/, '').replace(/^/, `${name(contest.riderNumber)}: `));
  const seriStart = firstLog(riderLogs, l => /番手を巡って/.test(l.message));
  const seriEnd = firstLog(riderLogs, l => /秒の競りに勝って/.test(l.message));
  if (seriStart) add('競り', `${name(seriStart.riderNumber)}が${seriStart.message.replace(/\s*\(.*\)/, '')}。${seriEnd ? `${name(seriEnd.riderNumber)}が${seriEnd.message.replace(/^.*?秒の競りに勝って、/, '').replace(/\s*\(.*\)/, '')}。` : ''}`);
  const switched = firstLog(riderLogs, l => /切り替える/.test(l.message));
  if (switched) add('攻防', `${name(switched.riderNumber)}は${switched.message.replace(/\s*\(.*\)/, '')}`);

  // バック・直線
  if (snapshots.back) add('バック', `バックでは ${fmtOrder(snapshots.back.order, lineOf)}。`);
  // 脚が一杯になった選手: 着外ならタレた、3着以内なら苦しいながらも粘った
  const top3Cars = ranking.slice(0, 3).map(r => r.number);
  const tired = riderLogs.filter(l => l.category === 'FATIGUE' && R(l) <= 260).slice(0, 2);
  for (const t of tired) add('直線', top3Cars.includes(t.riderNumber) ? `${name(t.riderNumber)}は脚が一杯になりながらも粘る。` : `${name(t.riderNumber)}は脚が一杯でタレる。`);
  const inner = firstLog(riderLogs, l => /内を突く/.test(l.message));
  if (inner && ranking.slice(0, 3).some(r => r.number === inner.riderNumber)) add('直線', `${name(inner.riderNumber)}が内を突いて伸びる。`);

  // 結果
  const frontMateOf = n => { const l = setup.lines.find(x => x.members.includes(n)); const i = l ? l.members.indexOf(n) : -1; return i > 0 ? l.members[i - 1] : null; };
  const k = kimarite(snapshots, ranking, frontMateOf, logs);
  if (k && ranking.length >= 3) {
    const [a, b, c] = ranking;
    add('ゴール', `${name(a.number)}が${k.how}で1着。2着${name(b.number)}${k.marks.includes(b.number) ? '(マーク)' : ''}、3着${name(c.number)}${k.marks.includes(c.number) ? '(マーク)' : ''}。`);
  }
  return { story, kimarite: k };
}
