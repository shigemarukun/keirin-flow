// KEIRIN FLOW — 「AIの展開予想」パネル
// 本命の展開 (隊列 → 展開の文章 → 着順) と、何通りもの未来 (調子をゆらして何十回も走らせた結果) を表示する。

import { predictRace, forecastRaces } from './forecast.js';

const RUNS = 30;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => `${Math.round(v * 100)}%`;
const CAR_BG = { 1: '#ffffff', 2: '#222222', 3: '#e60012', 4: '#0068b7', 5: '#ffd400', 6: '#00a651', 7: '#f08300', 8: '#ff69b4', 9: '#7f3fbf' };
const CAR_FG = { 1: '#111', 2: '#fff', 3: '#fff', 4: '#fff', 5: '#111', 6: '#fff', 7: '#111', 8: '#111', 9: '#fff' };
const carChip = n => `<span class="fc-car" style="background:${CAR_BG[n]};color:${CAR_FG[n]}">${n}</span>`;
const combo = key => String(key).split('-').map(n => carChip(Number(n))).join('<span class="fc-dash">-</span>');

export function mountForecastPanel(container, { onWatch } = {}) {
  if (!container) return { update() {} };
  let worker = null, jobId = 0;
  try { worker = new Worker(new URL('./forecast-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }

  let state = { main: null, forecast: null, progress: 0, names: {} };

  const render = () => {
    const { main, forecast, progress, names } = state;
    if (!main) { container.innerHTML = '<p class="empty-result">予想を計算中…</p>'; return; }
    const name = n => names[n] ? `<small>${esc(names[n])}</small>` : '';
    const marks = forecast?.marks ?? {};
    const mark = n => marks[n] ? `<b class="fc-mark">${marks[n]}</b>` : '';

    // 表示する展開: 未来の計算が終わったら「本線 / 対抗 / 穴」、それまでは能力どおりの1レース
    const scenarios = forecast?.scenarios ?? [];
    const sel = Math.min(state.sel ?? 0, Math.max(0, scenarios.length - 1));
    const sc = scenarios[sel] ?? null;
    const shown = sc ?? { order: main.ranking.map(r => r.number), kimarite: main.kimarite, story: main.story, seed: null };
    const top3 = shown.order.slice(0, 3);
    const k = shown.kimarite;

    let html = '';
    if (scenarios.length) {
      html += `<div class="fc-tabs" role="tablist">${scenarios.map((x, i) => `
        <button type="button" role="tab" class="fc-tab${i === sel ? ' is-on' : ''}" data-sel="${i}" aria-selected="${i === sel}">
          <span>${esc(x.label)}</span><strong>${combo(x.exacta)}</strong><small>${forecast.n}回中${x.count}回</small>
        </button>`).join('')}</div>`;
    }
    const cond = (sc?.notable ?? []).map(x => `${x.car}番の調子が${x.condition > 0 ? '良い' : '重い'}`).join('、');
    html += `
      <div class="fc-main">
        <div class="fc-label">${sc ? `AIの${esc(sc.label)}の展開` : 'AIの予想 <small>(何通りもの未来を計算中…)</small>'}</div>
        <div class="fc-order">${top3.map((n, i) => `<span class="fc-place"><em>${i + 1}着</em>${carChip(n)}${mark(n)}${name(n)}</span>`).join('')}</div>
        ${k ? `<div class="fc-kimarite">決まり手: <strong>${esc(k.how)}</strong>${sc ? ` ・ ${forecast.n}回中${sc.count}回 (${pct(sc.rate)})` : ''}</div>` : ''}
        ${cond ? `<div class="fc-cond">この展開になりやすい日: ${esc(cond)}</div>` : ''}
      </div>
      <ol class="fc-story">
        ${shown.story.map(s => `<li><span class="fc-phase">${esc(s.phase)}</span><span>${esc(s.text)}</span></li>`).join('')}
      </ol>
      <button type="button" class="primary-btn fc-watch" data-seed="${shown.seed ?? ''}">▶ この展開をコースで見る</button>`;

    if (!forecast) {
      html += `<div class="fc-future"><div class="fc-label">何通りもの未来</div><p class="ri-help">選手の調子を少しずつ変えて${RUNS}回走らせています… ${progress}/${RUNS}</p></div>`;
    } else {
      const cars = Object.keys(forecast.win).map(Number).sort((a, b) => (forecast.win[b] - forecast.win[a]) || (forecast.top3[b] - forecast.top3[a]));
      html += `
        <div class="fc-future">
          <div class="fc-label">何通りもの未来 <small>(調子を変えて${forecast.n}回)</small></div>
          <div class="fc-bars">
            ${cars.map(c => `
              <div class="fc-bar-row">
                ${carChip(c)}<b class="fc-mark fc-mark-bar">${marks[c] ?? ''}</b>
                <div class="fc-bar"><i class="fc-bar-top3" style="width:${forecast.top3[c] * 100}%"></i><i class="fc-bar-win" style="width:${forecast.win[c] * 100}%"></i></div>
                <span class="fc-bar-num">1着${pct(forecast.win[c])}<br><small>3着内${pct(forecast.top3[c])}</small></span>
              </div>`).join('')}
          </div>
          <p class="ri-help">◎○▲=1着になりやすい順、△=3着以内に入りやすい。濃い色=1着になった割合、薄い色=3着以内に入った割合</p>
          <div class="fc-grid">
            <div><div class="fc-sub">よく出た3連単</div>${forecast.trifecta.map(t => `<div class="fc-combo">${combo(t.key)}<span>${pct(t.rate)}</span></div>`).join('')}</div>
            <div><div class="fc-sub">よく出た2車単</div>${forecast.exacta.map(t => `<div class="fc-combo">${combo(t.key)}<span>${pct(t.rate)}</span></div>`).join('')}</div>
          </div>
          <div class="fc-sub">展開の分かれ道</div>
          <ul class="fc-branches">
            <li>決まり手: ${forecast.kimarite.map(x => `${esc(x.key)} ${pct(x.rate)}`).join(' / ')}</li>
            <li>バックを先頭で通過: ${forecast.backLeader.map(x => `${x.key}番 ${pct(x.rate)}`).join(' / ')}</li>
            <li>前受けが突っ張りきる: ${pct(forecast.branches.tsuppari)} / 誘導切りが決まる: ${pct(forecast.branches.cutSucceeded)}</li>
          </ul>
        </div>`;
    }
    container.innerHTML = html;
  };

  container.addEventListener('click', event => {
    const tab = event.target.closest('.fc-tab');
    if (tab) { state.sel = Number(tab.dataset.sel); render(); return; }
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
    state = { main: null, forecast: null, progress: 0, sel: 0, names: setup?.meta?.names ?? {} };
    render();
    if (!setup) return;
    const plain = JSON.parse(JSON.stringify(setup));
    if (worker) {
      worker.onmessage = event => {
        const msg = event.data;
        if (msg.id !== jobId) return;
        if (msg.type === 'main') state.main = msg.main;
        if (msg.type === 'progress') state.progress = msg.done;
        if (msg.type === 'forecast') state.forecast = msg.forecast;
        if (msg.type === 'error') { worker = null; runOnMainThread(plain, id); return; }
        render();
      };
      worker.onerror = () => { worker = null; runOnMainThread(plain, id); };
      worker.postMessage({ id, setup: plain, runs: RUNS });
    } else {
      runOnMainThread(plain, id);
    }
  };

  return { update, getLast: () => state };
}
