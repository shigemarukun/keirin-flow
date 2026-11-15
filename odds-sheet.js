// KEIRIN FLOW — オッズを入れる画面 (下から出るシート)
// 貼り付けたそばから読み取って、何通り読めたか・本物らしいか・いつ時点かを見せる。
import { openSheet, closeSheet } from './glossary.js';
import { parseOddsText, checkOdds, ODDS_PROMPT } from './odds.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function openOddsSheet({ cars, current, onSave }) {
  let text = current?.text ?? '', parsed = null, at = current?.at ?? '';
  const sheet = document.getElementById('sheet');
  const summary = () => {
    if (!text.trim()) return '<p class="ri-help">まだ何も貼られていません。</p>';
    parsed = parseOddsText(text, cars);
    if (!parsed.count) return '<p class="ri-warn">オッズを読み取れませんでした。「1-2-3 12.5」「1-2 3.4」のように、組み合わせと倍率が並んだ形で貼ってください。</p>';
    if (parsed.at && !at) at = parsed.at;
    const chk = checkOdds(parsed.odds, cars.length);
    return `<p class="ri-ok">${parsed.count}通りのオッズを読み取りました${parsed.at ? ` (${esc(parsed.at)}時点)` : ''}</p>
      <ul class="od-notes">${chk.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      ${chk.warn.map(w => `<p class="ri-warn">⚠ ${esc(w)}</p>`).join('')}
      ${!chk.ok ? '<p class="ri-warn">AIに頼んだオッズは、作られた数字のことがあります。公式・投票サイトの画面と見比べてください。</p>' : ''}
      ${!Object.keys(parsed.odds.exacta).length ? '<p class="ri-help">2車単の全通りがあると、「みんなの見立て」の1着率と、3連単の倍率の推定が正確になります。</p>' : ''}`;
  };
  const html = () => `
    <p class="le-help">オッズは「投票した人みんなの見立て」です。AIの見立てと比べて、ズレている選手 (狙い目・人気しすぎ) と、3連単の本命・中穴・穴を出します。<b>締め切りまで動く</b>ので、締め切りの数分前に入れ直すのがおすすめです。</p>
    <details class="od-prompt"><summary>AI (チャッピーなど) に頼むときの文</summary>
      <pre class="bt-example">${esc(ODDS_PROMPT)}</pre>
      <button type="button" class="secondary-btn od-copy">この文をコピー</button></details>
    <textarea class="od-text" rows="6" placeholder="例:\n23時20分時点\n2車単\n1-2 8.4\n1-3 12.1\n…\n3連単\n5-3-7 18.2\n…">${esc(text)}</textarea>
    <label class="od-at">いつ時点のオッズか <input type="time" class="od-time" value="${esc(at)}"></label>
    <div class="od-sum">${summary()}</div>
    <div class="le-actions">
      <button type="button" class="primary-btn od-save">このオッズを使う</button>
      ${current ? '<button type="button" class="secondary-btn od-clear">オッズを消す</button>' : '<button type="button" class="secondary-btn" data-close>やめる</button>'}
    </div>`;
  openSheet('オッズを入れる', html(), 'odds');
  const content = sheet.querySelector('.sheet-content');
  const onInput = event => {
    if (sheet.dataset.mode !== 'odds') return;
    if (event.target.closest('.od-text')) { text = event.target.value; content.querySelector('.od-sum').innerHTML = summary(); const t = content.querySelector('.od-time'); if (t && !t.value && at) t.value = at; }
    if (event.target.closest('.od-time')) at = event.target.value;
  };
  const onClick = event => {
    if (sheet.dataset.mode !== 'odds') return;
    if (event.target.closest('.od-copy')) { navigator.clipboard?.writeText(ODDS_PROMPT).then(() => { event.target.textContent = 'コピーしました'; }).catch(() => {}); return; }
    if (event.target.closest('.od-clear')) { onSave(null); cleanup(); closeSheet(); return; }
    if (event.target.closest('.od-save')) {
      parsed = parseOddsText(text, cars);
      if (!parsed.count) { content.querySelector('.od-sum').innerHTML = summary(); return; }
      const chk = checkOdds(parsed.odds, cars.length);
      onSave({ text, at: at || parsed.at || nowHM(), odds: parsed.odds, ok: chk.ok, warn: chk.warn, savedAt: new Date().toISOString() });
      cleanup(); closeSheet();
    }
  };
  const cleanup = () => { content.removeEventListener('input', onInput); sheet.removeEventListener('click', onClick); obs.disconnect(); };
  const obs = new MutationObserver(() => { if (sheet.hidden || sheet.dataset.mode !== 'odds') cleanup(); });
  obs.observe(sheet, { attributes: true, attributeFilter: ['hidden', 'data-mode'] });
  content.addEventListener('input', onInput);
  sheet.addEventListener('click', onClick);
}
