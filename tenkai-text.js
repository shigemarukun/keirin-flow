// KEIRIN FLOW — 文章で書いた展開を読み取る
//
// 例: 「7番が打鐘でカマして、棚瀬は引いて巻き返し。久田は中団から捲り。9番は番手捲り。並び 19 438 72 56」
//   → 7番: カマシ(打鐘から) / 1番: 前受けなら引く / 5番: 捲り / 9番: 番手捲り / 周回の並び 19・438・72・56
//
// お金のかかるAIは使わず、競輪の言葉の辞書で読む (iPhoneでもすぐ動く・無料)。
// 選手は 車番 (5番・⑤・5号車) / 名前 (久田・久田君) / ライン (7番ライン・九州ライン・関東の3番手) で指せる。
// 読めなかったところは「分からなかった」として返す (勝手に推測して決めない)。
//
// 返すもの: { changes: (レースデータに入れる指定), readings: [人が読む読み取り結果], unknown: [読めなかった文], outcomes: [結果の言葉] }

import { REGION_OF } from './race-data.js';

// ---------- 文字をそろえる ----------
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ')
    .replace(/[①-⑨]/g, ch => `${CIRCLED.indexOf(ch) + 1}番`)
    .replace(/([一二三四五六七八九])(番車|号車|番(?!手))/g, (_, k, s) => `${KANJI_NUM[k]}${s}`)
    .replace(/まくり|マクリ/g, '捲り').replace(/まく(る|っ|ら|れ)/g, '捲$1')
    .replace(/かまし|カマシ/g, 'カマシ').replace(/かま(す|さ|せ|し)/g, 'カマ$1')
    .replace(/つっぱ/g, '突っ張').replace(/ツッパ/g, '突っ張')
    .replace(/じゃん|ジャン/g, '打鐘').replace(/ハコ/g, '番手')
    .replace(/～|〜/g, '〜');
}

// ---------- 仕掛けどころ (400バンクに直した残りの距離 m) ----------
// 赤板=残り2周(約770m) / 打鐘=残り1周半(約600m) / 最終ホーム=残り1周(400m) / バック=残り半周(200m)
const TIMING = [
  [/青板/, 1150, '青板(残り3周)'],
  [/赤板(過ぎ|すぎ|後)/, 720, '赤板過ぎ'], [/赤板(前|手前)/, 800, '赤板の前'], [/赤板/, 770, '赤板'],
  [/打鐘(前|手前)|鐘(前|手前)/, 640, '打鐘の前'], [/打鐘(過ぎ|すぎ|後|のあと)|鐘(過ぎ|すぎ)/, 540, '打鐘過ぎ'], [/打鐘|鐘/, 600, '打鐘'],
  [/残り?1周半|ラスト1周半/, 600, '残り1周半'],
  [/(最終)?ホーム(過ぎ|すぎ)/, 380, 'ホーム過ぎ'], [/最終ホーム|残り?1周(?!半)|ラスト1周|最終周回?(に入って|の頭)/, 400, '最終ホーム'],
  [/(1|一)(角|コーナー)/, 370, '1コーナー'], [/(1|一)センター/, 340, '1センター'], [/(2|二)(角|コーナー)/, 300, '2コーナー'],
  [/(最終)?バック(手前|前)/, 240, 'バックの手前'], [/(最終)?バック(過ぎ|すぎ)/, 170, 'バック過ぎ'], [/(最終)?バック|残り?半周|ラスト半周/, 200, '最終バック'],
  [/(3|三)(角|コーナー)/, 160, '3コーナー'], [/(2|二)センター/, 130, '2センター'], [/(4|四)(角|コーナー)/, 100, '4コーナー'],
  [/(最後の|最終)?直線|ゴール前/, 65, '最後の直線']
];
function findTiming(s) {
  const m = s.match(/残り?\s*(\d{2,4})\s*m/i);
  if (m) return { rem: Math.min(1200, Number(m[1])), label: `残り${m[1]}m` };
  for (const [re, rem, label] of TIMING) if (re.test(s)) return { rem, label };
  return null;
}

// ---------- 地区 (「九州ライン」「関東勢」など) ----------
const REGION_WORDS = [
  [/北日本|東北|北海道/, '北日本'], [/南関東?|南関/, '南関東'], [/関東/, '関東'], [/中部|東海|北陸/, '中部'], [/近畿|関西/, '近畿'],
  [/中四国/, ['中国', '四国']], [/中近/, ['中部', '近畿']], [/中国/, '中国'], [/四国/, '四国'], [/九州/, '九州']
];

// ---------- 言葉の辞書 ----------
// 結果の言葉 (展開の指定にはしない): 1着・逃げ切り・タレる・千切れ・落車 …
const OUTCOME = /逃げ切|押し切|残る|残す|粘り込|1着|2着|3着|勝つ|勝ち|優勝|タレ|垂れ|千切れ|ちぎれ|口が(開|空)|飛ぶ|飛んで|落車|失格|不発|沈む|届か|ズブズブ|ワンツー|ライン決着|着外/;

// 1つの言葉の意味: kind = tactic / front / formation / bante / switch / tobi / seri / block / cut / follow
const VOCAB = [
  // 二段駆け: ラインの先頭が早めに駆けて、番手がそこから出る
  { re: /二段駆け|二段がけ/, kind: 'nidan' },
  // 番手捲り (番手の選手が、前を見捨てて自分から仕掛ける)
  { re: /番手(から)?捲|番手から(踏|仕掛|出|行)|前を(見捨|捨て)|自分で(踏|仕掛|行|出)|自力に(切り?替|転)/, kind: 'bante' },
  // 切り替え・飛びつき
  { re: /切り?替え|切替|スイッチ|乗り換え|乗り替え/, kind: 'switch' },
  { re: /飛び?付|飛びつ|とびつ/, kind: 'tobi' },
  // 競り (番手を取り合う)
  { re: /(番手|後ろ|後位)を?(競|奪|取り?に|狙)|番手勝負|競り(込|に|合)?|競る|追い上げマーク|イン粘り|内競り|外競り|イン待ち/, kind: 'seri' },
  // 誘導切り・インを斬る・抑えに行く
  { re: /誘導(を)?切|インを?斬|イン切り|抑えに|抑えて|抑える|押さえ(に|て|る)/, kind: 'cut' },
  // 前受けの動き
  { re: /突っ張|譲らな|渡さな|出させな|行かせな|引かな|下げな|張り合/, kind: 'front', value: 'TSUPPARI' },
  { re: /中団を?(取|確保|狙|キープ)|(前|中)に入れ|入れて|入れる|出させ(?!な)|行かせ(?!な)|受け入れ|迎え入れ/, kind: 'front', value: 'CHUDAN' },
  { re: /引い|引く|引き(?!つけ|付け)|下げ(?!な)|下がっ|後方まで|後方に|巻き返/, kind: 'front', value: 'HIKU' },
  // 戦法 (ラインの先頭・自力の単騎)
  { re: /カマ[しすさせ]|一気に(前|叩|出|行|踏)|一気(?!捲)|奇襲/, kind: 'tactic', value: 'KAMASHI' },
  { re: /一発/, kind: 'tactic', value: 'MAKURI' },
  { re: /ロング捲|先捲|早め(に|の)?捲/, kind: 'tactic', value: 'MAKURI', early: true },
  { re: /捲り追い?込|まくり追い?込|捲り差し/, kind: 'tactic', value: 'MAKURI', late: true },
  { re: /捲[りるっらられ]|一気捲/, kind: 'tactic', value: 'MAKURI' },
  { re: /突っ張り先行/, kind: 'tactic', value: 'SENKO' },
  { re: /先行|主導権|逃げ(?!切)|逃げる|徹底先行|ペース駆け|抑え先行|押し出し先行|叩[いくきか]|出切|バックを(取|踏まず)|駆け[るて]|駆ける|先手|機関車|もがき合|叩き合|主導権争/, kind: 'tactic', value: 'SENKO' },
  { re: /追い?込|差し|差す|脚を?(溜|た)め|溜め|ためて|ためる|様子見|待って|待つ|直線勝負|末脚|内を突|中割|イン突/, kind: 'tactic', value: 'OIKOMI' },
  // ブロック (番手の仕事)
  { re: /ブロック(しない|せず)|張らな|張らず|牽制(しない|せず)|ヨコ(をせず|はしない)/, kind: 'block', value: false },
  { re: /ブロック|張る|張って|牽制|ヨコ|仕事|締め|蓋をする|蓋を/, kind: 'block', value: true },
  // 周回の位置 (初手)
  { re: /前受け|Sを取|スタートを取|前を取|前から(攻|行|組)|初手(は)?前|誘導員の後ろ|前々/, kind: 'formation', value: 'FRONT' },
  { re: /後ろ攻め|後方から(攻|組)|初手(は)?後ろ|最後方|後攻め|後方(で|に|待機)|後方$|後ろで(待|構)/, kind: 'formation', value: 'BACK' },
  { re: /中団から|初手(は)?中団|中段/, kind: 'formation', value: 'MIDDLE' },
  // 「中団」だけ: 前受けの選手なら「出させて中団を取る」、それ以外なら周回の位置
  { re: /中団/, kind: 'chudan' },
  // 「仕掛ける」「踏む」「行く」: 戦法はそのまま (AIの見立て)、仕掛けどころだけ決める
  { re: /仕掛け|踏み(出|込)|踏む|踏んで|スパート|動く|動いて|発進/, kind: 'go' },
  // 追走 (マーク・付ける) — 番手・3番手の基本の動き
  { re: /マーク|付け(る|て)|ジカ付|直付|追走|ついて|付いて/, kind: 'follow' }
];
export const TACTIC_JA = { SENKO: '先行', KAMASHI: 'カマシ', MAKURI: '捲り', OIKOMI: '追込' };
export const FRONT_JA = { TSUPPARI: '突っ張る', HIKU: '引く', CHUDAN: '中団を取る' };

// ---------- 選手・ラインを指す言葉 ----------
function riderFinder(data) {
  const riders = data?.riders ?? [];
  const lines = (data?.lines ?? []).map(g => [...g]);
  const lineOf = car => lines.find(g => g.includes(car)) ?? [car];
  // 名前: フルネーム、姓 (先頭2〜3文字)、名 (後ろ2文字)。同じ呼び方が2人に当たるなら使わない
  const keys = [];
  for (const r of riders) {
    const n = String(r.name ?? '').replace(/\s/g, '');
    if (n.length < 2) continue;
    const parts = String(r.name ?? '').trim().split(/\s+/);
    const cands = new Set([n, parts[0], n.slice(0, 2), n.slice(0, 3), parts[1] ?? null].filter(x => x && x.length >= 2));
    for (const k of cands) keys.push({ key: k, car: Number(r.car) });
  }
  const uniq = keys.filter(k => keys.filter(x => x.key === k.key && x.car !== k.car).length === 0).sort((a, b) => b.key.length - a.key.length);
  const prefOf = car => riders.find(r => Number(r.car) === car)?.pref;
  const cars = new Set(riders.map(r => Number(r.car)));

  // 文の中で選手を指している場所を、出てくる順に返す: [{ at, len, car, line?, pos? }]
  return function find(s) {
    const hits = [];
    const add = (at, len, car, extra = {}) => { if (cars.has(car) && !hits.some(h => at < h.at + h.len && h.at < at + len)) hits.push({ at, len, car, ...extra }); };
    // ライン + 位置: 「7番ラインの番手」「九州の3番手」「佐藤ラインの先頭」
    const pos = { 先頭: 0, 先行: 0, 自力: 0, 番手: 1, '2番手': 1, '3番手': 2, 三番手: 2, '4番手': 3, 四番手: 3, 後ろ: 1 };
    const linePos = (lineCars, word) => { const i = pos[word]; return i == null ? null : lineCars[i] ?? null; };
    // 「7番ライン」「佐藤ライン」「九州ライン」(+「の番手」など)
    const lineRe = /([1-9])\s*(?:番|号車)?\s*(?:ライン|ラインの|の?ライン)(?:の?(先頭|先行|自力|番手|2番手|3番手|三番手|4番手|四番手))?/g;
    for (const m of s.matchAll(lineRe)) {
      const g = lineOf(Number(m[1]));
      const car = m[2] ? linePos(g, m[2]) : g[0];
      if (car) add(m.index, m[0].length, car, { line: g });
    }
    // 「4-3-8」「19」のように並びで書いたライン
    for (const m of s.matchAll(/(?<![\d.])([1-9])(?:\s*[-ー－・]\s*[1-9]){1,4}(?![\d.])/g)) {
      const cs = m[0].split(/[^1-9]+/).filter(Boolean).map(Number);
      const g = lines.find(gr => gr[0] === cs[0] && cs.every(c => gr.includes(c)));
      if (g) add(m.index, m[0].length, g[0], { line: g });
    }
    for (const { key, car } of uniq) {
      const re = new RegExp(`${key}(?:\\s*(?:君|くん|選手|さん|氏))?(?:\\s*(ライン|ラインの|の)\\s*(先頭|先行|自力|番手|2番手|3番手|三番手|4番手|四番手))?`, 'g');
      for (const m of s.matchAll(re)) {
        const g = lineOf(car);
        const target = m[2] ? linePos(g, m[2]) : car;
        if (target) add(m.index, m[0].length, target, m[1] === 'ライン' || m[1] === 'ラインの' || m[2] ? { line: g } : {});
      }
    }
    for (const [re, region] of REGION_WORDS) {
      const r = new RegExp(`(${re.source})(?:勢|ライン|の)?\\s*(?:の)?\\s*(先頭|先行|自力|番手|2番手|3番手|三番手|4番手|四番手)?`, 'g');
      for (const m of s.matchAll(r)) {
        if (!/勢|ライン|先頭|番手|自力|先行/.test(m[0])) continue; // 「中部」だけでは選手を指さない
        const regions = [region].flat();
        const g = lines.find(gr => regions.includes(REGION_OF[prefOf(gr[0])]));
        if (!g) continue;
        const word = m[m.length - 1];
        const car = word ? linePos(g, word) : g[0];
        if (car) add(m.index, m[0].length, car, { line: g });
      }
    }
    // 車番: 「5番」「5号車」「5番車」「5の」「5が」(数字だけのときは、助詞が続くときに限る)
    for (const m of s.matchAll(/(?<![\d.])([1-9])\s*(番車|号車|番(?!手)|号|車(?!立|身)|(?=\s*(?:が|は|の(?!m)|を|に|と|も|で|、|,|\s|$)))/g)) {
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (/^(周|角|コ|セ|m|着|車立|分戦|日)/.test(after)) continue; // 「4角」「1周」「2着」などは選手ではない
      if (/[\d]/.test(s[m.index - 1] ?? '')) continue;
      add(m.index, m[0].length, Number(m[1]));
    }
    return hits.sort((a, b) => a.at - b.at);
  };
}

// ---------- 並び (「並び 19 438 72 56」「1-9/7-2/4-3-8/5-6」) ----------
function findLines(s) {
  const m = s.match(/(?:並び|周回|初手|隊列|ライン)\s*(?:は|が|:|：)?\s*([1-9](?:[1-9\s\/／\-ー－・|｜→←、,]*[1-9])?)/);
  const raw = m?.[1] ?? s.match(/(?:^|\s)([1-9]{1,4}(?:\s*[\/／|｜]\s*[1-9]{1,4}){1,8})(?=\s|$)/)?.[1]
    ?? s.match(/(?:^|\s)([1-9](?:-[1-9]){0,4}(?:\s+[1-9](?:-[1-9]){0,4}){1,8})(?=\s|$|。)/)?.[1];
  if (!raw) return null;
  const groups = raw.split(/[\s\/／|｜、,→←]+/).filter(Boolean).map(g => g.split(/[-ー－・]/).join('').split('').map(Number));
  const flat = groups.flat();
  if (groups.length < 2 || new Set(flat).size !== flat.length) return null;
  return groups;
}

// 今の指定で、周回の先頭 (前受け) になるライン
function applyFront(lines0, changes) {
  let lines = (changes.lines ?? lines0).map(g => [...g]);
  for (const mv of changes.formationMoves) { const i = lines.findIndex(g => g.includes(mv.line[0])); if (i < 0) continue; const [g] = lines.splice(i, 1); if (mv.to === 'FRONT') lines.unshift(g); else if (mv.to === 'BACK') lines.push(g); else lines.splice(Math.floor(lines.length / 2), 0, g); }
  return lines;
}

// ---------- 本体 ----------
export function parseTenkaiText(text, data) {
  const src = normalizeText(text);
  const find = riderFinder(data);
  const lines0 = (data?.lines ?? []).map(g => [...g]);
  const lineOf = car => lines0.find(g => g.includes(car)) ?? [car];
  const isLeader = car => lineOf(car)[0] === car;
  const changes = { tactics: {}, frontResponse: {}, tenkai: {}, lines: null, formationMoves: [] };
  const readings = [], unknown = [], outcomes = [];
  const note = (car, text) => readings.push({ car, text });
  const opt = car => (changes.tenkai[car] ??= {});

  // 並び (文全体から)
  const lineSpec = findLines(src);
  if (lineSpec) {
    changes.lines = lineSpec;
    readings.push({ car: null, text: `周回の並び: ${lineSpec.map(g => g.join('')).join(' / ')}` });
  }

  // 文と節に分ける (「。」「、」「て、」など)
  const sentences = src.split(/[。．!?！？\n]+/).map(x => x.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (lineSpec && /^(並び|周回|初手|隊列)/.test(sentence)) continue;
    const clauses = sentence.split(/[、,]|(?<=て)\s|(?<=で)\s/).map(x => x.trim()).filter(Boolean);
    let subject = null; // 主語は、次の節にも引き継ぐ (「7番が打鐘でカマして、そのまま押し切る」)
    let understood = false;
    for (const clause of clauses) {
      const hits = find(clause);
      // 動詞の前にある最後の選手を主語に。「XがYの番手を競る」のように2人出てきたら、後ろの方を相手にする
      const acts = [];
      for (const v of VOCAB) {
        const m = clause.match(v.re);
        if (!m) continue;
        // 打ち消し (「カマさず」「捲らない」): その言葉は使わない (「出させない」「引かない」などは辞書の方で読む)
        if (v.kind !== 'front' && v.kind !== 'block' && /^[^、。]{0,3}?(ず|ない|なかっ|ません)/.test(clause.slice(m.index + m[0].length)) && !/出させ|行かせ|譲ら|渡さ|引か|下げ/.test(m[0])) {
          acts.push({ kind: 'skip', at: m.index, len: m[0].length, word: m[0] });
          continue;
        }
        // 同じ場所を、より細かい言葉ですでに読んでいたら使わない (例: 「番手捲り」を「捲り」としても読まない)
        if (acts.some(a => m.index < a.at + a.len && a.at < m.index + m[0].length)) continue;
        acts.push({ ...v, at: m.index, len: m[0].length, word: m[0] });
      }
      if (OUTCOME.test(clause) && !acts.length) { outcomes.push(clause); understood = true; continue; }
      if (!acts.length) { if (hits.length) subject = hits[hits.length - 1]; continue; }
      const timing = findTiming(clause);
      const early = /早め|早く|早目|先に/.test(clause), late = /遅め|ギリギリ|ぎりぎり|引きつけ|引き付け|ためて|溜めて/.test(clause);
      for (const act of acts.sort((a, b) => a.at - b.at)) {
        const before = hits.filter(h => h.at < act.at), after = hits.filter(h => h.at > act.at);
        const subj = (before.length ? before[0] : null) ?? subject ?? after[0] ?? null;
        // 「棚瀬と佐藤がもがき合い」: 「と」でつないだ2人とも
        const pair = before.length >= 2 && /^\s*と\s*$/.test(clause.slice(before[0].at + before[0].len, before[1].at)) ? before[1] : null;
        if (act.kind === 'skip') continue;
        // 相手 (切り替え先・競る相手・飛びつく相手): 主語以外で、いちばん近くに出てくる選手
        const other = [...before.slice(1), ...after].find(h => h.car !== subj?.car) ?? null;
        if (!subj) { unknown.push(`${clause} (誰のことか分かりませんでした)`); continue; }
        subject = subj;
        const car = subj.car, who = `${car}番`;
        understood = true;
        switch (act.kind) {
          case 'tactic': {
            if (!isLeader(car) && !['OIKOMI'].includes(act.value)) {
              if (act.value === 'MAKURI' || act.value === 'KAMASHI' || act.value === 'SENKO') {
                // 番手・3番手が「捲る」「踏む」= 番手捲り (前の選手を見捨てて自分から)
                opt(car).banteMakuri = timing?.rem ?? (act.value === 'KAMASHI' ? 520 : 260);
                note(car, `${who}: 番手から自分で仕掛ける (番手捲り${timing ? `・${timing.label}` : ''})`);
              }
              break;
            }
            if (!isLeader(car)) { note(car, `${who}: 差し・追い込み (番手・3番手の基本の動き)`); break; }
            changes.tactics[car] = act.value;
            let rem = timing?.rem ?? null;
            if (act.early && rem == null) rem = 430;
            if (act.late && rem == null) rem = 130;
            if (rem == null && (early || late)) rem = { SENKO: 410, KAMASHI: 540, MAKURI: 330, OIKOMI: 0 }[act.value] + (early ? 70 : -70);
            if (rem != null && act.value !== 'OIKOMI') opt(car).strike = rem;
            note(car, `${who}: ${TACTIC_JA[act.value]}${act.early ? ' (早めから)' : ''}${act.late ? ' (直線寄り)' : ''}${rem != null && act.value !== 'OIKOMI' && (timing || early || late) ? ` ・仕掛けは${timing?.label ?? (early ? '早め' : '遅め')}から` : ''}`);
            if (pair && isLeader(pair.car)) { changes.tactics[pair.car] = act.value; note(pair.car, `${pair.car}番: ${TACTIC_JA[act.value]}`); }
            if (act.kind === 'tactic' && /突っ張り先行/.test(act.word)) { changes.frontResponse[car] = 'TSUPPARI'; note(car, `${who}: 前受けなら突っ張る`); }
            break;
          }
          case 'front': {
            const g = lineOf(car), leader = g[0];
            changes.frontResponse[leader] = act.value;
            note(leader, `${leader}番: 前受けで誘導切りに来られたら${FRONT_JA[act.value]}${leader !== car ? ` (${who}のライン)` : ''}`);
            if (act.value === 'HIKU' && /巻き返/.test(clause) && !changes.tactics[leader]) { changes.tactics[leader] = timing?.rem >= 450 ? 'KAMASHI' : 'SENKO'; if (timing) opt(leader).strike = timing.rem; note(leader, `${leader}番: 引いてから巻き返す (${TACTIC_JA[changes.tactics[leader]]}${timing ? `・${timing.label}から` : ''})`); }
            break;
          }
          case 'formation': {
            const g = lineOf(car);
            changes.formationMoves.push({ line: g, to: act.value });
            note(g[0], `${g.join('')}のライン: 周回は${{ FRONT: '前受け (誘導員の後ろ)', BACK: '後ろ攻め', MIDDLE: '中団' }[act.value]}`);
            if (act.value === 'MIDDLE' && /捲/.test(clause) && isLeader(car) && !changes.tactics[car]) { /* 「中団から捲り」は捲りの方で読む */ }
            break;
          }
          case 'chudan': {
            const g = lineOf(car), leader = g[0];
            const front = (applyFront(lines0, changes))[0]?.[0];
            if (leader === front) { changes.frontResponse[leader] = 'CHUDAN'; note(leader, `${leader}番: 前受けで誘導切りに来られたら${FRONT_JA.CHUDAN}`); }
            else { changes.formationMoves.push({ line: g, to: 'MIDDLE' }); note(leader, `${g.join('')}のライン: 周回は中団`); }
            break;
          }
          case 'go': {
            const leader = isLeader(car);
            const rem = timing?.rem ?? (early ? 480 : late ? 150 : null);
            if (!leader) { opt(car).banteMakuri = rem ?? 260; note(car, `${who}: 番手から自分で仕掛ける (番手捲り${timing ? `・${timing.label}` : ''})`); break; }
            if (rem == null) { note(car, `${who}: 仕掛ける (どこからかは書かれていないので、AIの見立てのまま)`); break; }
            opt(car).strike = rem;
            note(car, `${who}: 仕掛けどころは${timing?.label ?? (early ? '早め' : '遅め')}から (戦法はAIの見立て${changes.tactics[car] ? `・${TACTIC_JA[changes.tactics[car]] ?? ''}` : ''})`);
            break;
          }
          case 'nidan': {
            const g = lineOf(car), leader = g[0], bante = g[1];
            changes.tactics[leader] = 'SENKO'; opt(leader).strike = timing?.rem ?? 520;
            if (bante) opt(bante).banteMakuri = 260;
            note(leader, `${g.join('')}のライン: 二段駆け (${leader}番が早めに先行し、${bante ?? '—'}番が番手から出る)`);
            break;
          }
          case 'bante': {
            opt(car).banteMakuri = timing?.rem ?? (early ? 330 : late ? 150 : 260);
            note(car, `${who}: 番手捲り (前の選手を残さず、自分から仕掛ける${timing ? `・${timing.label}` : ''})`);
            break;
          }
          case 'switch': {
            if (!other) { unknown.push(`${clause} (どの選手に切り替えるか分かりませんでした)`); break; }
            opt(car).switchTo = other.car;
            note(car, `${who}: 自分のラインの先頭が叩かれたら、${other.car}番の後ろに切り替える`);
            break;
          }
          case 'tobi': {
            opt(car).tobitsuki = other?.car ?? true;
            note(car, `${who}: 外を上がってくる${other ? `${other.car}番` : '選手'}の後ろに飛びつく`);
            break;
          }
          case 'seri': {
            // 「6番が3番の番手を競る」: 相手は「〇〇の番手」「〇〇の後ろ」の〇〇 (そのラインの先頭)
            const ref = hits.find(h => h.car !== car && /^\s*(の|ラインの)?\s*(番手|後ろ|後位|2番手)/.test(clause.slice(h.at + h.len)));
            const target = ref ? lineOf(ref.car)[0] : null;
            if (!target) { unknown.push(`${clause} (誰の番手を競るのか分かりませんでした。「3番の番手を競る」のように書いてください)`); break; }
            if (lineOf(car).length > 1) { unknown.push(`${clause} (番手を競れるのは、今は単騎の選手だけです)`); break; }
            changes.tactics[car] = `SERI:${target}`;
            note(car, `${who}: ${target}番の番手を競る`);
            break;
          }
          case 'cut': {
            const leader = lineOf(car)[0];
            opt(leader).cutPacer = true;
            note(leader, `${leader}番: 赤板あたりで誘導切り (前受けのラインを抑えにいく)`);
            break;
          }
          case 'block': {
            // ブロックは番手の仕事。ラインの先頭を指したときは、そのラインの番手のこと
            const g = lineOf(car), b = isLeader(car) && g.length > 1 ? g[1] : car;
            if (isLeader(car) && g.length < 2) { unknown.push(`${clause} (${who}は単騎なので、番手の仕事 (ブロック) はありません)`); break; }
            opt(b).noBlock = !act.value;
            note(b, `${b}番${b !== car ? ` (${who}の番手)` : ''}: ${act.value ? '番手の仕事 (外へ張って捲りを止める)' : 'ブロックはしない'}`);
            break;
          }
          case 'follow': {
            const tgt = other?.car;
            note(car, `${who}: ${tgt ? `${tgt}番に` : '前の選手に'}付いていく (マーク)`);
            break;
          }
        }
      }
    }
    if (!understood && !find(sentence).length && !lineSpec) unknown.push(sentence);
  }
  return { changes, readings, unknown, outcomes };
}

// 読み取った指定を、レースデータに入れる (今の指定に上書き。書かれていないことは今のまま)
export function applyTenkai(data, changes) {
  const d = structuredClone(data);
  d.tactics = { ...(d.tactics ?? {}), ...changes.tactics };
  d.frontResponse = { ...(d.frontResponse ?? {}), ...changes.frontResponse };
  const t = { ...(d.tenkai ?? {}) };
  for (const [car, o] of Object.entries(changes.tenkai)) t[car] = { ...(t[car] ?? {}), ...o };
  d.tenkai = t;
  if (changes.lines) { d.lines = changes.lines; d.autoFormation = false; }
  let lines = (d.lines ?? []).map(g => [...g]);
  for (const mv of changes.formationMoves ?? []) {
    const i = lines.findIndex(g => g.includes(mv.line[0]));
    if (i < 0) continue;
    const [g] = lines.splice(i, 1);
    if (mv.to === 'FRONT') lines.unshift(g);
    else if (mv.to === 'BACK') lines.push(g);
    else lines.splice(Math.floor(lines.length / 2), 0, g);
    d.autoFormation = false;
  }
  if (changes.formationMoves?.length) d.lines = lines;
  return d;
}
