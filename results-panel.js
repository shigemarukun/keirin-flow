// KEIRIN FLOW — 答え合わせ
// 実際の着順をタップで入れると、AIの本命・何通りもの未来と比べて「当たり/外れ」と
// 「AIはこの結果を何%と見ていたか」を出す。答え合わせの記録はスマホに残り、通算の的中率が分かる。

const STORAGE_KEY = 'keirin-flow:results:v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => `${Math.round(v * 100)}%`;
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } };
const saveHistory = h => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-200))); } catch { /* 保存できなくても動く */ } };

export function mountResultsPanel(container, { getSetup, getForecast }) {
  if (!container) return { reset() {} };
  let picked = [];

  const render = () => {
    const setup = getSetup();
    const cars = Object.keys(setup?.riders ?? {}).map(Number).sort((a, b) => a - b);
    const names = setup?.meta?.names ?? {};
    const history = loadHistory();
    const hits = key => history.filter(h => h[key]).length;
    const summary = history.length
      ? `<div class="rs-summary">これまで${history.length}レース: 本命1着 ${pct(hits('winHit') / history.length)} / 2車単 ${pct(hits('exactaHit') / history.length)} / 3連単 ${pct(hits('trifectaHit') / history.length)} / 3連単がAIの上位5点に入った ${pct(hits('trifectaInTop5') / history.length)}</div>`
      : '';
    container.innerHTML = `
      <p class="ri-help">実際の着順を、1着から順にタップしてください(3着まででOK)。</p>
      <div class="rs-cars">${cars.map(c => `<button type="button" class="rs-car car-${c}${picked.includes(c) ? ' is-picked' : ''}" data-car="${c}" ${picked.includes(c) ? 'disabled' : ''}>${c}${picked.includes(c) ? `<small>${picked.indexOf(c) + 1}着</small>` : ''}</button>`).join('')}</div>
      <div class="rs-picked">実際の着順: <strong>${picked.length ? picked.join(' - ') : '—'}</strong>${picked.length ? ` <button type="button" class="rs-undo">1つ戻す</button>` : ''}</div>
      <button type="button" class="primary-btn rs-check" ${picked.length >= 3 ? '' : 'disabled'}>答え合わせする</button>
      <div class="rs-out"></div>
      ${summary}
      ${history.length ? `<button type="button" class="secondary-btn rs-clear">答え合わせの記録を消す</button>` : ''}`;
    container._names = names;
  };

  const check = () => {
    const fc = getForecast();
    const out = container.querySelector('.rs-out');
    if (!fc?.main) { out.innerHTML = '<p class="ri-help">AIの予想の計算が終わるまで少し待ってください。</p>'; return; }
    // AIの本命 = 何通りもの未来で一番よく起きた展開 (本線)。まだ計算中なら能力どおりの1レース
    const ai = fc.forecast?.scenarios?.[0]?.order ?? fc.main.ranking.map(r => r.number);
    const [a1, a2, a3] = picked;
    const winHit = ai[0] === a1, exactaHit = ai[0] === a1 && ai[1] === a2, trifectaHit = exactaHit && ai[2] === a3;
    const tri = `${a1}-${a2}-${a3}`;
    const f = fc.forecast;
    const triRate = f?.trifecta.find(t => t.key === tri)?.rate ?? 0;
    const trifectaInTop5 = !!f?.trifecta.some(t => t.key === tri);
    const mark = ok => ok ? '<b class="rs-ok">当たり</b>' : '<b class="rs-ng">外れ</b>';
    // 着順のズレが大きかった選手 (AIの予想着順と実際の着順の差)
    const gaps = picked.map((c, i) => ({ c, real: i + 1, ai: ai.indexOf(c) + 1 })).filter(x => Math.abs(x.real - x.ai) >= 3);
    out.innerHTML = `
      <ul class="rs-list">
        <li>AIの本命 ${ai.slice(0, 3).join('-')} / 実際 ${picked.slice(0, 3).join('-')}</li>
        <li>1着: ${mark(winHit)} ・ 2車単: ${mark(exactaHit)} ・ 3連単: ${mark(trifectaHit)}</li>
        ${f ? `<li>実際の1着 ${a1}番を、AIは<strong>1着率${pct(f.win[a1] ?? 0)}</strong>と見ていた</li>
        <li>この3連単は、AIの${f.n}回のうち${pct(triRate)}で出ていた${trifectaInTop5 ? ' (上位5点に入っていた)' : ''}</li>` : ''}
        ${gaps.length ? `<li>大きく外れた選手: ${gaps.map(g => `${g.c}番 (AI ${g.ai}着 → 実際 ${g.real}着)`).join('、')}。この選手の得点・脚質・並びの入力を見直すと、次の予想が良くなるかもしれません</li>` : ''}
      </ul>`;
    const history = loadHistory();
    history.push({ at: new Date().toISOString(), race: getSetup()?.meta?.race ?? {}, ai: ai.slice(0, 3), real: picked.slice(0, 3), winHit, exactaHit, trifectaHit, trifectaInTop5 });
    saveHistory(history);
    const sum = container.querySelector('.rs-summary');
    const h = loadHistory(); const hits = key => h.filter(x => x[key]).length;
    const html = `<div class="rs-summary">これまで${h.length}レース: 本命1着 ${pct(hits('winHit') / h.length)} / 2車単 ${pct(hits('exactaHit') / h.length)} / 3連単 ${pct(hits('trifectaHit') / h.length)} / 3連単がAIの上位5点に入った ${pct(hits('trifectaInTop5') / h.length)}</div>`;
    if (sum) sum.outerHTML = html; else out.insertAdjacentHTML('afterend', html);
  };

  container.addEventListener('click', event => {
    const car = event.target.closest('.rs-car');
    if (car) { picked.push(Number(car.dataset.car)); render(); return; }
    if (event.target.closest('.rs-undo')) { picked.pop(); render(); return; }
    if (event.target.closest('.rs-check')) { check(); return; }
    if (event.target.closest('.rs-clear')) { saveHistory([]); render(); }
  });

  render();
  return { reset() { picked = []; render(); } };
}
