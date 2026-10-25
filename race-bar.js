// KEIRIN FLOW — いま予想しているレースと「今日のレース」
// 入れたレースを残しておき、タップで切り替える。新しいレースは「貼り付けて予想」の1タップで。
import { raceLabelOf } from './race-input.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GRADE = { S: 'S級', A: 'A級', C: 'チャレンジ', L: 'ガールズ' };

export function mountRaceBar(container, { input, onSelected }) {
  if (!container) return { render() {}, note() {} };
  let note = null, editing = false;

  const render = () => {
    const data = input.getData();
    const sample = input.isSample();
    const races = input.races();
    const cur = input.currentId();
    const n = data?.riders?.length ?? 0;
    const lines = (data?.lines ?? []).map(g => g.join('')).join(' / ');
    const grade = GRADE[data?.race?.grade] ?? (data?.race?.girls ? 'ガールズ' : '');
    container.innerHTML = `
      <div class="rb-current">
        ${sample
          ? '<div class="rb-title">サンプルのレース</div><div class="rb-sub">自分で予想したいレースの出走表を貼り付けてください</div>'
          : `<div class="rb-title">${esc(raceLabelOf(data))}</div><div class="rb-sub">${[grade, n ? `${n}車立て` : '', lines ? `並び ${esc(lines)}` : ''].filter(Boolean).join('・')}</div>`}
      </div>
      <div class="rb-actions">
        <button type="button" class="primary-btn rb-paste">貼り付けて予想</button>
        <button type="button" class="secondary-btn rb-open">${sample ? '入力のしかた' : '出走表を直す'}</button>
      </div>
      ${note ? `<p class="rb-note${note.warn ? ' is-warn' : ''}" role="status">${esc(note.text)}</p>` : ''}
      ${races.length ? `
        <div class="rb-list-head"><span>入れたレース</span>${races.length > 1 || editing ? `<button type="button" class="rb-edit">${editing ? '終わる' : '整理'}</button>` : ''}</div>
        <div class="rb-list">${races.map(r => `
          <span class="rb-chip${r.id === cur ? ' is-on' : ''}">
            <button type="button" class="rb-pick" data-id="${esc(r.id)}" ${r.id === cur ? 'aria-current="true"' : ''}>${esc(r.label)}</button>
            ${editing ? `<button type="button" class="rb-del" data-id="${esc(r.id)}" aria-label="${esc(r.label)}を消す">×</button>` : ''}
          </span>`).join('')}</div>` : ''}`;
  };

  container.addEventListener('click', async event => {
    if (event.target.closest('.rb-paste')) {
      // コピーした文字をそのまま読んで予想。読めない端末では入力欄を開く
      const ok = await input.pasteFromClipboard();
      if (!ok) { input.openPaste(); note = { text: '入力欄を長押しして「ペースト」し、「読み取って予想」を押してください。' }; render(); }
      return;
    }
    if (event.target.closest('.rb-open')) { input.openPaste(); return; }
    if (event.target.closest('.rb-edit')) { editing = !editing; render(); return; }
    const del = event.target.closest('.rb-del');
    if (del) { input.remove(del.dataset.id); render(); return; }
    const pick = event.target.closest('.rb-pick');
    if (pick && pick.dataset.id !== input.currentId()) {
      if (input.select(pick.dataset.id)) { note = null; render(); onSelected?.(); }
    }
  });

  render();
  return {
    render,
    note(text, warn = false) { note = text ? { text, warn } : null; render(); }
  };
}
