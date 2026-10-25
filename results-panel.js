// KEIRIN FLOW — 答え合わせ
//
// 1) レースの前に「予想を確定」して、スマホに保存する
// 2) レースのあとで実際の着順をタップすると、確定した予想を採点する (scoring.js)
// 結果を見てから予想を作り直すと良く見えてしまうので、通算の成績には「確定した予想」だけを数える。
import { makeLock, scoreLock, summarize, fingerprint } from './scoring.js';
import { buildAdvice } from './advice.js';

const STORAGE_KEY = 'keirin-flow:locks:v1';
const OLD_KEY = 'keirin-flow:results:v1'; // 確定の仕組みより前の記録 (数だけ表示する)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const load = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const save = locks => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(locks.slice(-200))); return true; } catch { return false; } };
const raceLabel = l => [l.race?.venue, l.race?.raceNo ? `${l.race.raceNo}R` : '', l.race?.name].filter(Boolean).join(' ') || 'レース';
const timeLabel = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function mountResultsPanel(container, { getSetup, getForecast }) {
  if (!container) return { reset() {} };
  let picked = [], note = '', lastScore = null, target = null; // target: 採点する確定予想のid

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
        <p class="ri-help">いまの予想 (本線・印・買い目・何通りもの未来) を、このスマホに保存します。結果が出たら、この予想で答え合わせします。</p>
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
    if (!fc?.forecast || fc.refining) { note = '予想の計算が終わるまで少し待ってから、もう一度押してください。'; render(); return; }
    const sc = fc.forecast.scenarios?.[0];
    const advice = sc ? buildAdvice({ runs: fc.forecast.runs, scenario: sc, marks: fc.forecast.marks, names: setup?.meta?.names ?? {} }) : null;
    const l = makeLock({ setup, forecast: fc.forecast, main: fc.main, advice, adviceLabel: sc ? `${sc.label}(${sc.theme ?? ''})` : '' });
    const locks = load(STORAGE_KEY); locks.push(l);
    note = save(locks) ? `${timeLabel(l.lockedAt)} に確定しました。本線 ${l.main.join('-')}${l.advice ? `・買い目${l.advice.points}点` : ''}` : 'このブラウザでは保存できませんでした (プライベートモードなど)';
    target = l.id; render();
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
    const score = scoreLock(l, picked.slice(0, 3));
    if (counted) { l.result = { ...score, at: new Date().toISOString() }; save(locks); }
    lastScore = { score, counted, lock: l };
    render();
  };

  container.addEventListener('click', event => {
    const car = event.target.closest('.rs-car');
    if (car) { if (picked.length < 3) picked.push(Number(car.dataset.car)); render(); return; }
    if (event.target.closest('.rs-undo')) { picked.pop(); render(); return; }
    if (event.target.closest('.rs-check')) { check(); return; }
    if (event.target.closest('.rs-lock')) { lock(); return; }
    const del = event.target.closest('.rs-del');
    if (del) { save(load(STORAGE_KEY).filter(l => l.id !== del.dataset.id)); render(); return; }
    if (event.target.closest('.rs-clear')) { save([]); lastScore = null; render(); }
  });
  container.addEventListener('change', event => {
    if (event.target.closest('.rs-target')) { target = event.target.value; render(); }
  });

  render();
  return { reset() { picked = []; note = ''; lastScore = null; target = null; render(); }, render };
}
