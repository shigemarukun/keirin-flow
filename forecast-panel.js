// KEIRIN FLOW — 「AIの展開予想」パネル
// 本命の展開 (隊列 → 展開の文章 → 着順) と、何通りもの未来 (調子をゆらして何十回も走らせた結果) を表示する。

import { predictRace, forecastRaces } from './forecast.js';
import { RaceAI } from './race-ai.js';
import { buildAdvice, adviceText, groupedKeys } from './advice.js';
import { linkTerms } from './glossary.js';
import { buildBets, betsText, BET_TYPES } from './bets.js';
import { toFormations, formationText } from './formation.js';
import { marketWin, marketTrifecta, gaps, trifectaTiers, ODDS_TYPES } from './odds.js';

const BET_KEY = 'keirin-flow:bet-type';
const loadBetType = () => { try { const v = localStorage.getItem(BET_KEY); return BET_TYPES.some(b => b.id === v) ? v : 'trio'; } catch { return 'trio'; } };

const STYLE_LABEL = { SENKO: '先行', MAKURI: '捲り', KAMASHI: 'カマシ', OIKOMI: '追込' };
const ai = new RaceAI();

// AIの選手の見立て: 得点・級班・経歴から決めた地力と、ラインでの役割・戦法・千切れの危なさ
function riderEvalHtml(setup, forecast, marks) {
  if (!setup?.riders) return '';
  const names = setup.meta?.names ?? {}, levels = setup.meta?.levels ?? {};
  const roleOf = n => {
    const line = setup.lines?.find(l => l.members.includes(n));
    if (!line) return { label: '単騎', front: null };
    const i = line.members.indexOf(n);
    return { label: ['先頭', '番手', '3番手', '4番手'][i] ?? `${i + 1}番手`, front: i > 0 ? line.members[i - 1] : null, leader: line.members[0] };
  };
  const order = (setup.formation ?? []).flat().filter(n => setup.riders[n]);
  const seenTags = new Set();
  const rows = order.map(n => {
    const p = setup.riders[n], role = roleOf(n), lv = levels[n] ?? {};
    const style = role.label === '先頭' || role.label === '単騎' ? (STYLE_LABEL[p.tactic] ?? STYLE_LABEL[ai.styleOf({ profile: p, mindset: p.mindset })]) : 'マーク';
    const notes = [];
    if (lv.history) notes.push(lv.steps?.find(x => /本来|昇級|特別/.test(x)) ?? '');
    // EXデータの根拠
    const exLine = (setup.meta?.conversion?.[n] ?? []).find(x => x.startsWith('EX:'));
    if (exLine) notes.push(exLine.replace(/ → 脚質.*$/, ''));
    const aptLine = (setup.meta?.conversion?.[n] ?? []).find(x => x.startsWith('EXの成績'));
    if (aptLine) notes.push(aptLine);
    const meetLine = (setup.meta?.conversion?.[n] ?? []).find(x => x.startsWith('今開催'));
    if (meetLine) notes.push(meetLine);
    if ((role.label === '先頭' || role.label === '単騎') && p.frontPlanProbs && p.frontPlanFromEx) {
      const fp = p.frontPlanProbs, P = v => `${Math.round((v ?? 0) * 100)}%`;
      notes.push(`前受けなら: 引く${P(fp.HIKU)}・中団${P(fp.CHUDAN)}・突っ張る${P(fp.TSUPPARI)}`);
    }
    // 千切れ: 前の選手との脚の差 (地力の差) が大きい追走選手は、全開の踏み出しに付いていけない
    if (role.front) {
      const gapPow = (setup.riders[role.leader]?.power ?? 0) - p.power;
      const ch = forecast?.chigire?.[n] ?? null;
      if (ch != null) { if (ch >= 0.1) notes.push(`⚠ 千切れやすい (${forecast.n}回中${Math.round(ch * forecast.n)}回で前に付いていけず)`); }
      else if (gapPow >= 0.12) notes.push(`⚠ ${role.leader}番との脚の差が大きく、千切れに注意 (計算中)`);
    }
    const w = Math.round(Math.max(0, Math.min(1, (p.power - 0.4) / 0.6)) * 100);
    return `<li class="re-row">
      ${carChip(n)}<b class="fc-mark">${marks[n] ?? ''}</b>
      <div class="re-main">
        <div class="re-top"><span class="re-name">${esc(names[n] || `${n}番`)}</span><span class="re-tag">${esc(lv.cls ?? '')}</span><span class="re-tag">${linkTerms(role.label, seenTags)}</span><span class="re-tag re-style">${linkTerms(style, seenTags)}</span></div>
        <div class="re-bar" title="地力 ${p.power}"><i style="width:${w}%"></i></div>
        <div class="re-sub">得点${lv.raw ?? '—'}${lv.level != null && Math.abs(lv.level - lv.raw) >= 0.5 ? ` → 実力${lv.level}点相当` : ''} ・ 地力${p.power.toFixed(2)}${notes.filter(Boolean).length ? `<br>${notes.filter(Boolean).map(esc).join('<br>')}` : ''}</div>
      </div>
    </li>`;
  });
  return `<details class="re-panel"><summary>AIの選手の見立て <small>(地力・役割・戦法)</small></summary>
    <ol class="re-list">${rows.join('')}</ol>
    <p class="ri-help">${linkTerms('地力', new Set())}は、競走得点に級班(長い目で見た実力)と経歴(元S級・特別昇級など)を加えて決めています。並びは周回の前から。</p></details>`;
}

const RUNS = 60; // 何通りもの未来の回数 (30回で先に見せ、60回まで走らせて精度を上げる)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => `${Math.round(v * 100)}%`;
const CAR_BG = { 1: '#ffffff', 2: '#222222', 3: '#e60012', 4: '#0068b7', 5: '#ffd400', 6: '#00a651', 7: '#f08300', 8: '#ff69b4', 9: '#7f3fbf' };
const CAR_FG = { 1: '#111', 2: '#fff', 3: '#fff', 4: '#fff', 5: '#111', 6: '#fff', 7: '#111', 8: '#111', 9: '#fff' };
const carChip = n => `<span class="fc-car" style="background:${CAR_BG[n]};color:${CAR_FG[n]}">${n}</span>`;
const combo = key => String(key).split('-').map(n => carChip(Number(n))).join('<span class="fc-dash">-</span>');

export function mountForecastPanel(container, { onWatch, onLock, getOdds = () => null, onOdds } = {}) {
  if (!container) return { update() {} };
  let worker = null, jobId = 0;
  try { worker = new Worker(new URL('./forecast-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }

  let state = { main: null, forecast: null, progress: 0, names: {} };

  // 本線の展開を、初心者にも分かるひとことにする
  const oneLiner = (sc, setup) => {
    const names = setup?.meta?.names ?? {};
    const nm = n => names[n] ? `${n}番(${names[n]})` : `${n}番`;
    const [w, s2, s3] = sc.order;
    const how = sc.kimarite?.how ?? '';
    const line = setup?.lines?.find(l => l.members.includes(w));
    const pos = line ? line.members.indexOf(w) : -1;
    const parts = [];
    const fp = sc.theme?.match(/前受け(\d)番は(.+?)\)/);
    if (fp) parts.push(`前受けの${fp[1]}番は${fp[2] === '引く' ? '引いて巻き返しを狙い' : fp[2] === '突っ張る' ? '突っ張って前を守り' : `${fp[2]}`}`);
    if (sc.mainLine != null) parts.push(`${sc.mainLine}番のラインが主導権を取る`);
    let win;
    if (/逃/.test(how)) win = `${nm(w)}がそのまま逃げ切って1着`;
    else if (/捲/.test(how)) win = line && sc.mainLine === line.members[0] ? `${nm(w)}が捲って前に出て、そのまま1着` : `${nm(w)}が捲って1着`;
    else if (/差/.test(how)) win = `${pos === 1 ? '番手の' : pos === 2 ? '3番手の' : ''}${nm(w)}が直線で差して1着`;
    else win = `${nm(w)}が1着`;
    return `${parts.length ? parts.join('。') + '。' : ''}${win}、2着${s2}番・3着${s3}番。`;
  };

  const render = () => {
    const { main, forecast, progress, names } = state;
    if (!main) {
      container.innerHTML = `<div class="fc-hero fc-loading"><div class="fc-label">AIの結論</div><p>AIの選手が、調子を変えながら${RUNS}回レースを走っています…</p><div class="fc-prog"><i style="width:${Math.round(progress / RUNS * 100)}%"></i></div></div>`;
      return;
    }
    const name = n => names[n] ? `<small>${esc(names[n])}</small>` : '';
    const marks = forecast?.marks ?? {};
    const mark = n => marks[n] ? `<b class="fc-mark">${marks[n]}</b>` : '';
    const seen = new Set();

    // 表示する展開: 未来の計算が終わったら「本線 / 対抗 / 波乱」、それまでは能力どおりの1レース
    const scenarios = forecast?.scenarios ?? [];
    const sel = Math.min(state.sel ?? 0, Math.max(0, scenarios.length - 1));
    const sc = scenarios[sel] ?? null;
    const shown = sc ?? { order: main.ranking.map(r => r.number), kimarite: main.kimarite, story: main.story, seed: null };
    const top3 = shown.order.slice(0, 3);
    const k = shown.kimarite;
    const race = state.setup?.meta?.race ?? {};
    const raceLabel = [race.venue, race.raceNo ? `${race.raceNo}R` : ''].filter(Boolean).join(' ');

    // この展開の買い目 (3連単)
    const adv = sc && forecast?.runs ? buildAdvice({ runs: forecast.runs, scenario: sc, marks, names }) : null;
    state.advice = adv; state.adviceLabel = sc ? `${sc.label}(${sc.theme ?? ''}) ` : '';
    // 買い方ごとの買い目と当たる見込み (展開に関係なく、何通りもの未来すべてから)。レースの固さもここから
    const bets = forecast?.runs && !state.refining ? buildBets(forecast.runs.map(r => r.order)) : null;
    state.bets = bets;
    const conf = bets?.confidence ?? null;
    const betType = state.betType ?? (state.betType = loadBetType());
    const bt = bets?.types?.[betType];
    const carsAll = Object.keys(state.setup?.riders ?? {}).map(Number).sort((a, b) => a - b);
    const fchips = (keys, type) => toFormations(keys, type, carsAll).map(f => `<span class="ad-combo">${esc(f.text)}${f.points > 1 ? `<small>${f.points}点</small>` : ''}</span>`).join('');
    const row = (title, arr, cls) => arr.length ? `<div class="ad-row ${cls}"><span class="ad-kind">${title}</span><div class="ad-combos">${fchips(arr.map(x => x.key), 'trifecta')}</div></div>` : '';
    // オッズ (みんなの見立て) があれば、AIとのズレ・倍率つきの3連単
    const od = getOdds();
    const oddsOf = (type, key) => od?.odds?.[type]?.[type === 'trifecta' || type === 'exacta' ? key : key.split('-').map(Number).sort((a, b) => a - b).join('-')];
    const mw = od && bets ? marketWin(od.odds, carsAll) : null;
    const mTri = od && bets ? marketTrifecta(od.odds, carsAll) : null;
    const tiers = bets ? trifectaTiers(bets.table, mTri && Object.keys(mTri).length ? mTri : null) : null;
    const pct1 = v => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
    const minOdds = mTri && Object.keys(mTri).length ? Math.min(...Object.values(mTri).map(x => x.odds)) : null;
    const oddsFmt = v => v >= 100 ? `${Math.round(v)}倍` : `${v.toFixed(1)}倍`;

    let html = `
      <div class="fc-hero">
        <div class="fc-hero-head"><span class="fc-label">AIの結論${raceLabel ? ` <small>${esc(raceLabel)}</small>` : ''}</span>${conf ? `<span class="fc-conf fc-conf-${conf.cls}" title="${esc(conf.note)}">${conf.label}</span>` : ''}</div>
        ${scenarios.length > 1 ? `<div class="fc-tabs" role="tablist">${scenarios.map((x, i) => `
          <button type="button" role="tab" class="fc-tab${i === sel ? ' is-on' : ''}" data-sel="${i}" aria-selected="${i === sel}">
            <span>${esc(x.label)}</span><strong>${combo(x.exacta)}</strong><small>${pct(x.rate)}</small>
          </button>`).join('')}</div>` : ''}
        <div class="fc-order">${top3.map((n, i) => `<span class="fc-place"><em>${i + 1}着</em>${carChip(n)}${mark(n)}${name(n)}</span>`).join('<span class="fc-arrow">›</span>')}</div>
        <p class="fc-line">${sc ? linkTerms(oneLiner(sc, state.setup), seen) : 'AIが何通りもの未来を計算しています。まずは能力どおりに走らせた1レースの結果です。'}</p>
        ${k ? `<div class="fc-kimarite">${linkTerms('決まり手', seen)}: <strong>${linkTerms(k.how, seen)}</strong>${sc ? `<br><small>この主導権の形になったのは ${forecast.n}回中${sc.count}回 (${pct(sc.rate)})。着順まで同じとは限りません</small>` : ''}</div>` : ''}
        ${!forecast || state.refining ? `<div class="fc-prog" title="計算の進み具合"><i style="width:${Math.round(progress / RUNS * 100)}%"></i></div><p class="ri-help">${forecast ? 'さらに走らせて精度を上げています' : '何通りもの未来を計算中'}… ${progress}/${RUNS}</p>` : ''}
        ${conf ? `<p class="fc-confnote">${conf.label}: ${esc(conf.note)}${bets ? ` (一番ありそうな2車単でも ${pct(bets.topExacta)})` : ''}</p>` : ''}
        ${bets ? `<div class="bt-buy">
          <div class="fc-sub">買い方 <small><button type="button" class="term" data-term="軸">軸</button> ${carChip(bets.axis)} ${names[bets.axis] ? esc(names[bets.axis]) : ''} (1着の見込み ${pct(bets.axisWin)})</small></div>
          <div class="bt-types" role="tablist">${BET_TYPES.map(b => `<button type="button" role="tab" class="bt-type${b.id === betType ? ' is-on' : ''}" data-bet="${b.id}" aria-selected="${b.id === betType}"><span>${b.label}</span><small>${pct(bets.types[b.id].hit)}</small></button>`).join('')}</div>
          ${bt ? `<div class="ad-combos bt-tickets">${fchips(bt.tickets.map(t => t.key), betType)}</div>
          <p class="bt-hit">${bt.tickets.length}点で <strong>当たる見込み 約${Math.round(bt.hit * 100)}%</strong></p>
          ${od ? `<details class="bt-each"><summary>1点ずつ (AIの確率・オッズ)</summary><ul>${bt.tickets.map(t => { const o = oddsOf(betType, t.key); return `<li><b>${esc(t.key)}</b> AI ${pct1(t.p)}${o ? ` ・ ${oddsFmt(o)}` : ' ・ オッズなし'}</li>`; }).join('')}</ul></details>` : ''}
          <p class="ri-help">${linkTerms(bt.label, seen)} … ${esc(bt.desc)}。見込みは、AIが何通りもの未来から出した確率です。</p>` : ''}
        </div>` : forecast ? '<p class="ri-help">買い目は、未来の計算が終わってから出します…</p>' : ''}
        ${tiers ? `<div class="bt-buy tr-tiers">
          <div class="fc-sub">3連単の 本命・中穴・穴 <small>${mTri && Object.keys(mTri).length ? `オッズ ${esc(od.at ?? '')}時点` : 'オッズ未入力: AIの確率から出した目安の倍率で分けています'}</small></div>
          ${tiers.map(t => `<div class="tr-row tr-${t.id}"><div class="tr-head"><b>${t.label}</b><small>${esc(t.desc)}</small><span>見込み ${pct1(t.hit)}</span></div>
            ${t.list.length ? `<div class="ad-combos">${fchips(t.list.map(x => x.key), 'trifecta')}</div>
            <ul class="tr-list">${t.list.map(x => `<li><b>${esc(x.key)}</b> AI ${pct1(x.p)} ・ ${x.fromAi ? `目安 ${oddsFmt(x.odds)}` : `${oddsFmt(x.odds)}${x.est ? '(推定)' : ''}`}${x.mp != null ? ` <small>みんな ${pct1(x.mp)}${x.p > x.mp * 1.4 ? ' → AIの方が高い' : ''}</small>` : ''}</li>`).join('')}</ul>` : `<p class="ri-help">この倍率に入る組み合わせはありません${t.id === 'honmei' && minOdds ? ` (一番人気でも${oddsFmt(minOdds)}の、本命が無いレースです)` : ''}</p>`}
          </div>`).join('')}
        </div>` : ''}
        ${mw ? `<div class="bt-buy mk-box">
          <div class="fc-sub">AIの見立て と みんなの見立て (1着) <small>オッズ ${esc(od.at ?? '')}時点${mw.full ? '' : '・一部のオッズからの目安'}</small></div>
          <table class="mk-table"><thead><tr><th></th><th>AI</th><th>みんな</th><th></th></tr></thead><tbody>
          ${gaps(bets.win, mw.win, carsAll).map(g => `<tr class="mk-${g.tag.id}"><td>${carChip(g.car)} ${names[g.car] ? `<small>${esc(names[g.car])}</small>` : ''}</td><td>${pct(g.ai)}</td><td>${pct(g.market)}</td><td>${g.tag.label ? `<b>${g.tag.label}</b>` : ''}</td></tr>`).join('')}
          </tbody></table>
          <p class="ri-help">狙い目 = AIの方が1.4倍以上高く見ている選手。人気しすぎ = みんなの方が1.4倍以上高く見ている選手。</p>
        </div>` : ''}
        ${bets ? `<button type="button" class="secondary-btn od-open">${od ? `オッズ ${esc(od.at ?? '')}時点${od.ok === false ? ' ⚠ 怪しい' : ''} (入れ直す)` : 'オッズを入れて、みんなの見立てと比べる'}</button>` : ''}
        <div class="fc-actions">
          <button type="button" class="primary-btn fc-watch" data-seed="${shown.seed ?? ''}">▶ この展開をコースで見る</button>
          <button type="button" class="secondary-btn fc-lock" ${forecast && !state.refining ? '' : 'disabled'}>${state.locked ? '✓ 確定済み' : '予想を確定'}</button>
          ${bets ? '<button type="button" class="secondary-btn ad-copy">買い目をコピー</button>' : ''}
        </div>
        <p class="ri-help fc-note" role="status">${esc(state.note ?? '')}</p>
        <button type="button" class="fc-write">✎ 自分の読みで展開を変える</button>
      </div>`;

    // くわしく: 展開の流れ・買い目の理由・確率・選手の見立て
    let more = `
      <ol class="fc-story">
        ${shown.story.map(s => `<li><span class="fc-phase">${linkTerms(s.phase, seen)}</span><span>${linkTerms(s.text, seen)}</span></li>`).join('')}
      </ol>`;
    if (adv) {
      more += `
      <div class="ad-box">
        <div class="fc-label">「${esc(sc.label)}」の展開になったときの3連単 <small>${adv.points}点</small></div>
        ${adv.thin ? `<p class="ad-thin">この展開は${forecast.n}回中${adv.n}回だけなので、参考程度に</p>` : ''}
        ${row('本命', adv.honmei, 'ad-honmei')}${row('抑え', adv.osae, 'ad-osae')}${row('波乱', adv.ana, 'ad-ana')}
        <p class="ri-help">この展開になれば約${Math.round(adv.cover * 100)}%を押さえる点数です。ただし、この展開になるとは限らないので、レース全体で当たる見込みは約${Math.round(adv.overall * 100)}%です。</p>
        ${adv.notes.length ? `<ul class="ad-notes">${adv.notes.map(t => `<li>${linkTerms(t, seen)}</li>`).join('')}</ul>` : ''}
        <p class="ri-help">オッズは使っていません。波乱は「AIの見立てでは確率が低いけど、この展開なら起きうる」組み合わせです (配当の高さではありません)。</p>
        <p class="ri-help ad-copied" role="status"></p>
      </div>`;
    }
    if (forecast) {
      const cars = Object.keys(forecast.win).map(Number).sort((a, b) => (forecast.win[b] - forecast.win[a]) || (forecast.top3[b] - forecast.top3[a]));
      const cond = (sc?.notable ?? []).map(x => `${x.car}番の調子が${x.condition > 0 ? '良い' : '重い'}`).join('、');
      more += `
        <div class="fc-future">
          <div class="fc-label">何通りもの未来 <small>(調子を変えて${forecast.n}回)</small></div>
          ${cond ? `<p class="fc-cond">この展開になりやすい日: ${esc(cond)}</p>` : ''}
          <div class="fc-bars">
            ${cars.map(c => `
              <div class="fc-bar-row">
                ${carChip(c)}<b class="fc-mark fc-mark-bar">${marks[c] ?? ''}</b>
                <div class="fc-bar"><i class="fc-bar-top3" style="width:${forecast.top3[c] * 100}%"></i><i class="fc-bar-win" style="width:${forecast.win[c] * 100}%"></i></div>
                <span class="fc-bar-num">1着${pct(forecast.win[c])}<br><small>3着内${pct(forecast.top3[c])}</small></span>
              </div>`).join('')}
          </div>
          <p class="ri-help">${linkTerms('◎○▲=1着になりやすい順、△=3着以内に入りやすい。濃い色=1着率、薄い色=3着内率', seen)}</p>
          <div class="fc-grid">
            <div><div class="fc-sub">3連単の見立て</div>${forecast.trifecta.map(t => `<div class="fc-combo">${combo(t.key)}<span>${pct(t.rate)}</span></div>`).join('')}</div>
            <div><div class="fc-sub">2車単の見立て</div>${forecast.exacta.map(t => `<div class="fc-combo">${combo(t.key)}<span>${pct(t.rate)}</span></div>`).join('')}</div>
          </div>
          <div class="fc-sub">展開の分かれ道</div>
          <ul class="fc-branches">
            <li>決まり手: ${forecast.kimarite.map(x => `${esc(x.key)} ${pct(x.rate)}`).join(' / ')}</li>
            <li>${linkTerms('バック', seen)}を先頭で通過: ${forecast.backLeader.map(x => `${x.key}番 ${pct(x.rate)}`).join(' / ')}</li>
            <li>前受けが${linkTerms('突っ張り', seen)}きる: ${pct(forecast.branches.tsuppari)} / ${linkTerms('誘導切り', seen)}が決まる: ${pct(forecast.branches.cutSucceeded)}</li>
          </ul>
        </div>`;
    }
    more += riderEvalHtml(state.setup, forecast, marks);
    html += `<details class="fc-more"${state.moreOpen ? ' open' : ''}><summary>くわしく見る <small>展開の流れ・確率・選手の見立て</small></summary>${more}</details>`;
    container.innerHTML = html;
  };
  container.addEventListener('toggle', event => { if (event.target.classList?.contains('fc-more')) state.moreOpen = event.target.open; }, true);

  container.addEventListener('click', event => {
    const tab = event.target.closest('.fc-tab');
    if (tab) { state.sel = Number(tab.dataset.sel); render(); return; }
    // 「自分の展開を書いて走らせる」: 文章の入力欄へ移って、すぐ書けるようにする
    if (event.target.closest('.fc-write')) {
      const box = document.querySelector('.tt-text');
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => box?.focus({ preventScroll: true }), 350);
      return;
    }
    if (event.target.closest('.ad-copy')) {
      const text = state.bets ? betsText(state.bets, state.betType) : adviceText(state.advice, state.adviceLabel);
      (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => { state.note = '買い目をコピーしました'; render(); })
        .catch(() => { state.note = text; render(); });
      return;
    }
    const bb = event.target.closest('.bt-type');
    if (bb) { state.betType = bb.dataset.bet; try { localStorage.setItem(BET_KEY, state.betType); } catch { /* 覚えられなくても動く */ } render(); return; }
    if (event.target.closest('.od-open')) { onOdds?.(); return; }
    if (event.target.closest('.fc-lock')) {
      const r = onLock?.();
      if (r) { state.note = r.text; if (r.ok) state.locked = true; render(); }
      return;
    }
    const w = event.target.closest('.fc-watch');
    if (w) onWatch?.(w.dataset.seed ? Number(w.dataset.seed) : null);
  });

  const runOnMainThread = (setup, id) => {
    // 作業用スレッドが使えない端末では、画面を固めないよう少しずつ計算する
    setTimeout(() => {
      if (id !== jobId) return;
      state.main = predictRace(setup); render();
      setTimeout(() => {
        if (id !== jobId) return;
        state.forecast = forecastRaces(setup, RUNS); render();
      }, 30);
    }, 30);
  };

  const update = setup => {
    jobId += 1;
    const id = jobId;
    state = { main: null, forecast: null, progress: 0, sel: 0, names: setup?.meta?.names ?? {}, setup, moreOpen: state.moreOpen ?? false, betType: state.betType };
    render();
    if (!setup) return;
    const plain = JSON.parse(JSON.stringify(setup));
    if (worker) {
      worker.onmessage = event => {
        const msg = event.data;
        if (msg.id !== jobId) return;
        if (msg.type === 'main') state.main = msg.main;
        if (msg.type === 'progress') state.progress = msg.done;
        if (msg.type === 'partial') { state.forecast = msg.forecast; state.refining = true; }
        if (msg.type === 'forecast') { state.forecast = msg.forecast; state.refining = false; }
        if (msg.type === 'error') { worker = null; runOnMainThread(plain, id); return; }
        render();
      };
      worker.onerror = () => { worker = null; runOnMainThread(plain, id); };
      worker.postMessage({ id, setup: plain, runs: RUNS });
    } else {
      runOnMainThread(plain, id);
    }
  };

  return { update, getLast: () => state, render: () => { if (state.main) render(); } };
}
