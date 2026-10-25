// KEIRIN FLOW — 答え合わせ
//
// 1) レースの前に「予想を確定」して、スマホに保存する
// 2) レースのあとで実際の着順をタップすると、確定した予想を採点する (scoring.js)
// 結果を見てから予想を作り直すと良く見えてしまうので、通算の成績には「確定した予想」だけを数える。
import { makeLock, scoreLock, summarize, fingerprint } from './scoring.js';
import { buildAdvice } from './advice.js';
import { splitBatchText, prepareRace, scoreForecast, summarizeBatch, compareText, stripUserReads, setupOf } from './batch.js';
import { forecastRaces } from './forecast.js';

// 予想を1つ計算する (作業用スレッドがあればそこで。画面を止めない)
let bw = null, bwId = 0;
function runForecast(setup, runs, onProgress) {
  return new Promise((resolve, reject) => {
    if (bw === null) { try { bw = new Worker(new URL('./batch-worker.js', import.meta.url), { type: 'module' }); } catch { bw = false; } }
    if (!bw) { setTimeout(() => { try { resolve(forecastRaces(setup, runs)); } catch (e) { reject(e); } }, 20); return; }
    const id = ++bwId;
    const onMsg = e => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') { onProgress?.(e.data.done, e.data.total); return; }
      bw.removeEventListener('message', onMsg);
      if (e.data.type === 'done') resolve(e.data.forecast); else reject(new Error(e.data.message));
    };
    bw.addEventListener('message', onMsg);
    bw.postMessage({ id, setup, runs });
  });
}
const BATCH_KEY = 'keirin-flow:batch:v1';
const BATCH_RUNS = 60; // 画面の予想と同じ回数 (少ないと、3連単の確率がたまたまで大きくぶれる)
const MAIN_RUNS = 60;  // 画面の予想と同じ回数 (確定した予想の比べ直し用)
const BATCH_EXAMPLE = `小倉競輪 9R
1 棚瀬義大 S1 岐阜 101.20 逃
2 佐藤一伸 S2 福島 98.50 両
 … (出走表をそのまま貼る)
並び 16/23/45/7
展開: 久田が打鐘でカマす。棚瀬は引いて巻き返し  ← 書かなくてもよい
結果: 4-5-1
---
(次のレースの出走表)
結果: 7-4-5`;

const STORAGE_KEY = 'keirin-flow:locks:v1';
const OLD_KEY = 'keirin-flow:results:v1'; // 確定の仕組みより前の記録 (数だけ表示する)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const load = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const save = locks => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(locks.slice(-200))); return true; } catch { return false; } };
const raceLabel = l => [l.race?.venue, l.race?.raceNo ? `${l.race.raceNo}R` : '', l.race?.name].filter(Boolean).join(' ') || 'レース';
const timeLabel = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function mountResultsPanel(container, { getSetup, getForecast, getData = () => null }) {
  if (!container) return { reset() {} };
  let picked = [], note = '', lastScore = null, target = null; // target: 採点する確定予想のid
  // まとめて答え合わせ
  let batch = (() => { try { return JSON.parse(localStorage.getItem(BATCH_KEY) || 'null'); } catch { return null; } })();
  let batchText = '', batchBusy = null, batchStop = false, batchOpen = false;

  const currentLocks = () => { const fp = fingerprint(getSetup()); return load(STORAGE_KEY).filter(l => l.fingerprint === fp); };

  const render = () => {
    const setup = getSetup();
    const cars = Object.keys(setup?.riders ?? {}).map(Number).sort((a, b) => a - b);
    const locks = load(STORAGE_KEY);
    const mine = currentLocks();
    const open = mine.filter(l => !l.result);
    if (!target || !mine.some(l => l.id === target)) target = (open[open.length - 1] ?? mine[mine.length - 1])?.id ?? null;
    const sum = summarize(locks);
    const old = load(OLD_KEY).length;

    container.innerHTML = `
      <div class="rs-step">
        <div class="fc-label">① レースの前: 予想を確定する</div>
        <p class="ri-help">いまの予想 (本線・印・買い目・何通りもの未来) を、このスマホに保存します (予想カードの「予想を確定」と同じです)。結果が出たら、この予想で答え合わせします。</p>
        <button type="button" class="primary-btn rs-lock">この予想を確定して保存</button>
        ${note ? `<p class="ri-help rs-note" role="status">${esc(note)}</p>` : ''}
        ${mine.length ? `<p class="ri-help">このレースの確定済み: ${mine.map(l => `${timeLabel(l.lockedAt)}${l.result ? ' (採点済み)' : ''}`).join('、')}</p>` : ''}
      </div>
      <div class="rs-step">
        <div class="fc-label">② レースのあと: 結果を入れる</div>
        ${mine.length > 1 ? `<label class="ri-help">採点する予想 <select class="rs-target">${mine.map(l => `<option value="${l.id}" ${l.id === target ? 'selected' : ''}>${timeLabel(l.lockedAt)} 確定${l.result ? ' (採点済み)' : ''}</option>`).join('')}</select></label>` : ''}
        ${!mine.length ? '<p class="ri-help rs-warn">このレースの確定した予想がありません。答え合わせはできますが、通算の成績には数えません。</p>' : ''}
        <p class="ri-help">実際の着順を、1着から順にタップしてください (3着まで)。</p>
        <div class="rs-cars">${cars.map(c => `<button type="button" class="rs-car car-${c}${picked.includes(c) ? ' is-picked' : ''}" data-car="${c}" ${picked.includes(c) || picked.length >= 3 ? 'disabled' : ''}>${c}${picked.includes(c) ? `<small>${picked.indexOf(c) + 1}着</small>` : ''}</button>`).join('')}</div>
        <div class="rs-picked">実際の着順: <strong>${picked.length ? picked.join(' - ') : '—'}</strong>${picked.length ? ` <button type="button" class="rs-undo">1つ戻す</button>` : ''}</div>
        <button type="button" class="primary-btn rs-check" ${picked.length >= 3 ? '' : 'disabled'}>答え合わせする</button>
        <div class="rs-out">${lastScore ? scoreHtml(lastScore.score, lastScore.counted, lastScore.lock) : ''}</div>
      </div>
      ${sum ? summaryHtml(sum) : '<p class="ri-help">まだ採点した予想はありません。</p>'}
      ${batchHtml()}
      ${locks.length ? listHtml(locks) : ''}
      ${old ? `<p class="ri-help">(確定の仕組みより前の答え合わせ ${old}件は、通算に数えていません)</p>` : ''}`;
  };

  const scoreHtml = (s, counted, lock) => {
    const mark = ok => ok ? '<b class="rs-ok">当たり</b>' : '<b class="rs-ng">外れ</b>';
    const ai = lock?.main ?? [];
    const adv = s.adviceHit == null ? '' : s.adviceHit ? `<li>買い目 (${s.advicePoints}点) の<b class="rs-ok">「${esc(s.adviceHit)}」で的中</b></li>` : `<li>買い目 (${s.advicePoints}点) には<b class="rs-ng">入っていなかった</b></li>`;
    return `
      <ul class="rs-list">
        <li>AIの本線 ${ai.join('-')} / 実際 ${s.actual.join('-')} … 1着 ${mark(s.winHit)}・2車単 ${mark(s.exactaHit)}・3連単 ${mark(s.trifectaHit)}</li>
        <li>実際の3連単 ${s.key} に、AIは <strong>${pct(s.p, 1)}</strong> を付けていた (${s.combos}通り中 ${s.rank ?? '—'}番目)。当てずっぽうの <strong>${s.vsRandom.toFixed(1)}倍</strong></li>
        <li>実際の1着 ${s.actual[0]}番の1着率は ${pct(s.winP)} と見ていた</li>
        ${adv}
        ${s.aiOnly ? `<li>${esc(compareText(s, s.aiOnly))} (あなたの読み ${pct(s.p, 1)} / AIだけ ${pct(s.aiOnly.p, 1)})</li>` : s.aiOnlyPending ? '<li class="rs-sub">あなたの読みを入れなかった場合 (AIだけの予想) と比べています…</li>' : ''}
        <li class="rs-sub">対数損失 ${s.logLoss.toFixed(2)} (当てずっぽうなら ${s.logLossRandom.toFixed(2)}・小さいほど良い) / 1着のブライア ${s.brier.toFixed(3)}</li>
        ${counted ? '<li class="rs-sub">確定した予想なので、通算の成績に数えました</li>' : '<li class="rs-sub">確定前の予想なので、通算には数えていません</li>'}
      </ul>`;
  };

  const summaryHtml = s => `
    <div class="rs-summary">
      <div class="fc-label">確定した予想の通算 <small>${s.n}レース</small></div>
      <ul class="rs-list">
        <li>実際の3連単に付けていた確率は、平均で当てずっぽうの <strong>${s.vsRandom.toFixed(1)}倍</strong> (1倍より大きいほど、AIの見立てが役に立っている)</li>
        <li>本線の1着が当たった ${pct(s.winHit)} ・ 本線の3連単がそのまま当たった ${pct(s.trifectaHit)}</li>
        ${s.mine ? `<li>あなたの読みを入れた ${s.mine.n}レース: 読みで確率が上がった <strong>${s.mine.better}レース</strong>・下がった ${s.mine.worse}レース (当てずっぽうの ${s.mine.vsRandomMine.toFixed(1)}倍 / AIだけなら ${s.mine.vsRandomAi.toFixed(1)}倍)</li>` : ''}
        ${s.adviceHit != null ? `<li>買い目が当たった ${pct(s.adviceHit)} (${s.adviceN}レース・平均${s.advicePoints.toFixed(1)}点)</li>` : ''}
        <li class="rs-sub">対数損失 ${s.logLoss.toFixed(2)} (当てずっぽう ${s.logLossRandom.toFixed(2)}) / 1着のブライア ${s.brier.toFixed(3)}</li>
      </ul>
      ${s.n < 20 ? '<p class="ri-help">まだレース数が少ないので、たまたまの影響が大きい数字です (20レースほどで傾向が見えてきます)。</p>' : ''}
    </div>`;

  const listHtml = locks => `
    <details class="rs-history"><summary>確定した予想の一覧 (${locks.length}件)</summary>
      <ul class="rs-list">${[...locks].reverse().slice(0, 30).map(l => `
        <li>${esc(raceLabel(l))} <small>${timeLabel(l.lockedAt)}</small> 本線 ${l.main.join('-')} ${l.result ? `→ 実際 ${l.result.actual.join('-')} (${pct(l.result.p, 1)}・${l.result.vsRandom.toFixed(1)}倍)` : '<small>結果待ち</small>'}
          <button type="button" class="rs-del" data-id="${l.id}" aria-label="この予想を消す">消す</button></li>`).join('')}
      </ul>
      <button type="button" class="secondary-btn rs-clear">確定した予想をすべて消す</button>
    </details>`;

  const lock = () => {
    const fc = getForecast(), setup = getSetup();
    if (!fc?.forecast || fc.refining) { note = '予想の計算が終わるまで少し待ってから、もう一度押してください。'; render(); return { ok: false, text: note }; }
    const sc = fc.forecast.scenarios?.[0];
    const advice = sc ? buildAdvice({ runs: fc.forecast.runs, scenario: sc, marks: fc.forecast.marks, names: setup?.meta?.names ?? {} }) : null;
    const l = makeLock({ setup, forecast: fc.forecast, main: fc.main, advice, adviceLabel: sc ? `${sc.label}(${sc.theme ?? ''})` : '' });
    // あなたの読み (戦法・展開の指定) を入れていれば、入れなかった場合の出走表も残す (採点のときにAIだけの予想と比べる)
    const data = getData();
    const ai = stripUserReads(data);
    if (ai) { l.aiOnly = ai; l.tenkaiText = data?.tenkaiText ?? ''; }
    const locks = load(STORAGE_KEY); locks.push(l);
    note = save(locks) ? `${timeLabel(l.lockedAt)} に確定しました。本線 ${l.main.join('-')}${l.advice ? `・買い目${l.advice.points}点` : ''}${ai ? '・あなたの読み入り' : ''}` : 'このブラウザでは保存できませんでした (プライベートモードなど)';
    target = l.id; render();
    return { ok: /確定しました/.test(note), text: /確定しました/.test(note) ? `${note}。レースが終わったら「答え合わせ」で結果を入れてください` : note };
  };

  const check = () => {
    const locks = load(STORAGE_KEY);
    let l = locks.find(x => x.id === target && x.fingerprint === fingerprint(getSetup()));
    let counted = !!l;
    if (!l) {
      // 確定した予想が無い: いまの予想で採点だけする (通算には数えない)
      const fc = getForecast(), setup = getSetup();
      if (!fc?.forecast) { container.querySelector('.rs-out').innerHTML = '<p class="ri-help">AIの予想の計算が終わるまで少し待ってください。</p>'; return; }
      const sc = fc.forecast.scenarios?.[0];
      l = makeLock({ setup, forecast: fc.forecast, main: fc.main, advice: sc ? buildAdvice({ runs: fc.forecast.runs, scenario: sc, marks: fc.forecast.marks }) : null });
    }
    const actual = picked.slice(0, 3);
    const score = scoreLock(l, actual);
    if (counted) { l.result = { ...score, at: new Date().toISOString() }; save(locks); }
    if (counted && l.aiOnly) score.aiOnlyPending = true;
    lastScore = { score, counted, lock: l };
    render();
    if (!(counted && l.aiOnly)) return;
    // AIだけの予想 (あなたの読みを抜いたもの) を同じ回数で走らせて、同じ着順に何%を付けたか比べる
    let aiSetup;
    try { aiSetup = setupOf(l.aiOnly); } catch { score.aiOnlyPending = false; render(); return; }
    runForecast(aiSetup, MAIN_RUNS).then(fc => {
      const ai = scoreForecast(aiSetup, fc, actual);
      const all = load(STORAGE_KEY); const x = all.find(y => y.id === l.id);
      if (x?.result) { x.result.aiOnly = { p: ai.p, vsRandom: ai.vsRandom, main: ai.main, trifectaHit: ai.trifectaHit }; save(all); }
      score.aiOnly = ai; score.aiOnlyPending = false; render();
    }).catch(() => { score.aiOnlyPending = false; render(); });
  };

  // ---------- 過去のレースでまとめて答え合わせ ----------
  function batchHtml() {
    const sumB = batch?.rows ? summarizeBatch(batch.rows) : null;
    const yen = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
    const rowHtml = r => r.error
      ? `<li class="bt-row bt-err"><div class="bt-top"><b>${esc(r.label)}</b></div><div>${esc(r.error)}</div></li>`
      : `<li class="bt-row"><div class="bt-top"><b>${esc(r.label)}</b><span>実際 <strong>${r.actual.join('-')}</strong></span><span class="bt-ai">AI本線 ${r.ai.main.join('-')}</span></div>
          <div>実際の決着に <strong>${yen(r.ai.p)}</strong> <small>(${r.ai.combos}通り中 ${r.ai.rank ?? '—'}番目)</small>
          ${r.ai.winHit ? '<b class="rs-ok bt-tag">1着的中</b>' : ''}${r.ai.trifectaHit ? '<b class="rs-ok bt-tag">3連単的中</b>' : ''}${r.ai.adviceHit ? `<b class="rs-ok bt-tag">買い目的中(${esc(r.ai.adviceHit)})</b>` : ''}</div>
          ${r.mine ? `<div class="bt-mine">${esc(compareText(r.mine, r.ai))} (読み入り ${yen(r.mine.p)})</div>` : ''}</li>`;
    return `
      <details class="rs-step bt"${batchOpen || batchBusy ? ' open' : ''}>
        <summary class="fc-label">③ 過去のレースで、まとめて答え合わせ</summary>
        <p class="ri-help">終わったレースの出走表と結果を、何レース分でもまとめて貼り付けてください。AIが1レースずつ予想して、実際の決着にどれだけの確率を付けていたかを採点します。「展開: …」を書いたレースは、<b>あなたの読みを入れた予想</b>と<b>AIだけの予想</b>を比べます。</p>
        <details class="tt-help"><summary>書き方の例</summary><pre class="bt-example">${esc(BATCH_EXAMPLE)}</pre>
          <p class="tp-note">結果は「結果 4-5-1」「着順 4-5-1」「3連単 4-5-1」のどれでもOK。レースの間は「---」の行で区切ります (区切らなくても、結果の行でレースが終わったとみなします)。</p></details>
        <textarea class="bt-text" rows="6" placeholder="出走表 → 展開: … (書かなくてもよい) → 結果: 4-5-1 → --- → 次のレース">${esc(batchText)}</textarea>
        <div class="tt-actions">
          ${batchBusy ? '<button type="button" class="secondary-btn bt-stop">止める</button>' : '<button type="button" class="primary-btn bt-run">答え合わせする</button>'}
          ${batch?.rows?.length && !batchBusy ? '<button type="button" class="secondary-btn bt-clear">結果を消す</button>' : ''}
        </div>
        ${batchBusy ? `<p class="ri-help rs-note" role="status">${esc(batchBusy)}</p>` : ''}
        ${sumB ? `<div class="rs-summary">
          <div class="fc-label">まとめ <small>${sumB.n}レース${batch.at ? `・${timeLabel(batch.at)}` : ''}</small></div>
          <ul class="rs-list">
            <li>実際の決着に付けていた確率は、平均で当てずっぽうの <strong>${sumB.vsRandom.toFixed(1)}倍</strong></li>
            <li>本線の1着 ${pct(sumB.winHit)}・2車単 ${pct(sumB.exactaHit)}・3連単 ${pct(sumB.trifectaHit)} が当たった</li>
            ${sumB.adviceHit != null ? `<li>買い目 (平均${sumB.advicePoints.toFixed(1)}点) が当たった ${pct(sumB.adviceHit)}</li>` : ''}
            ${sumB.mine ? `<li>あなたの読みを入れた ${sumB.mine.n}レース: 読みで確率が上がった <strong>${sumB.mine.better}</strong>・下がった ${sumB.mine.worse} (当てずっぽうの ${sumB.mine.vsRandomMine.toFixed(1)}倍 / AIだけなら ${sumB.mine.vsRandomAi.toFixed(1)}倍)</li>` : ''}
          </ul>
          ${sumB.mine ? '<p class="ri-help">結果を知ってから書いた展開は、どうしても当たりやすくなります。本当の腕試しは、レースの前に①で確定してから。</p>' : ''}
          ${sumB.n < 20 ? '<p class="ri-help">レース数が少ないうちは、たまたまの影響が大きい数字です (20レースほどで傾向が見えてきます)。</p>' : ''}
        </div>` : ''}
        ${batch?.rows?.length ? `<ul class="bt-rows">${batch.rows.map(rowHtml).join('')}</ul>` : ''}
      </details>`;
  }
  const saveBatch = () => { try { localStorage.setItem(BATCH_KEY, JSON.stringify(batch)); } catch { /* 保存できなくても表示はする */ } };
  const runBatch = async () => {
    const blocks = splitBatchText(batchText);
    if (!blocks.length) { batchBusy = null; batch = { rows: [{ label: '—', error: '出走表と結果が見つかりませんでした (書き方の例を見てください)' }] }; render(); return; }
    batch = { at: new Date().toISOString(), rows: [] }; batchStop = false;
    for (let i = 0; i < blocks.length && !batchStop; i++) {
      const r = prepareRace(blocks[i]);
      if (!r.ok) { batch.rows.push({ label: r.label, error: r.error }); continue; }
      const head = `${i + 1}/${blocks.length}レース目 (${r.label}) を予想しています…`;
      batchBusy = head; render();
      try {
        const fc = await runForecast(r.aiSetup, BATCH_RUNS, (d, t) => { batchBusy = `${head} ${d}/${t}`; const el = container.querySelector('.bt .rs-note'); if (el) el.textContent = batchBusy; });
        const row = { label: r.label, actual: r.actual, ai: scoreForecast(r.aiSetup, fc, r.actual) };
        if (r.mineSetup && !batchStop) {
          batchBusy = `${head} (あなたの読み入り)`; render();
          row.mine = scoreForecast(r.mineSetup, await runForecast(r.mineSetup, BATCH_RUNS), r.actual);
        }
        batch.rows.push(row);
      } catch (e) { batch.rows.push({ label: r.label, error: `予想できませんでした (${e.message})` }); }
      saveBatch();
    }
    batchBusy = null; saveBatch(); render();
  };

  container.addEventListener('click', event => {
    const car = event.target.closest('.rs-car');
    if (car) { if (picked.length < 3) picked.push(Number(car.dataset.car)); render(); return; }
    if (event.target.closest('.rs-undo')) { picked.pop(); render(); return; }
    if (event.target.closest('.rs-check')) { check(); return; }
    if (event.target.closest('.rs-lock')) { lock(); return; }
    const del = event.target.closest('.rs-del');
    if (del) { save(load(STORAGE_KEY).filter(l => l.id !== del.dataset.id)); render(); return; }
    if (event.target.closest('.rs-clear')) { save([]); lastScore = null; render(); return; }
    if (event.target.closest('.bt-run')) { batchText = container.querySelector('.bt-text')?.value ?? ''; batchOpen = true; batchBusy = '準備しています…'; render(); runBatch(); return; }
    if (event.target.closest('.bt-stop')) { batchStop = true; batchBusy = '止めています (いま走らせているレースが終わったら止まります)…'; render(); return; }
    if (event.target.closest('.bt-clear')) { batch = null; saveBatch(); render(); }
  });
  container.addEventListener('input', event => { if (event.target.closest('.bt-text')) batchText = event.target.value; });
  container.addEventListener('toggle', event => { if (event.target.classList?.contains('bt')) batchOpen = event.target.open; }, true);
  container.addEventListener('change', event => {
    if (event.target.closest('.rs-target')) { target = event.target.value; render(); }
  });

  render();
  return { reset() { picked = []; note = ''; lastScore = null; target = null; render(); }, render, lock };
}
