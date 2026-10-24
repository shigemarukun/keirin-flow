// KEIRIN FLOW — 出走表の手入力画面
// 入力された出走表を「レースデータ」(race-data.js) にして、シミュレーションへ渡す。

import { STYLE, VENUES, bankOfVenue, SAMPLE_RACE_DATA, parseLines, formatLines, validateRaceData, toRaceSetup } from './race-data.js';

const STORAGE_KEY = 'keirin-flow:race-input:v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 予想のリンク共有: レースデータを URL の # の後ろに入れる ----------
export function encodeRaceData(data) {
  const json = JSON.stringify(data, (k, v) => (v === undefined || v === '' ? undefined : v));
  const bytes = new TextEncoder().encode(json);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeRaceData(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function shareUrl(data) {
  return `${location.origin}${location.pathname}#r=${encodeRaceData(data)}`;
}
function fromLink() {
  try {
    const m = location.hash.match(/[#&]r=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const data = decodeRaceData(m[1]);
    history.replaceState(null, '', location.pathname + location.search); // 一度読んだら URL から消す
    return data;
  } catch { return null; }
}

function load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } }
function save(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* 保存できない環境でも動く */ } }

export function mountRaceInput(container, { onApply }) {
  if (!container) return;

  const rowHtml = car => `
    <div class="ri-row" data-car="${car}">
      <span class="ri-car car-${car}">${car}</span>
      <input class="ri-name" type="text" placeholder="選手名" autocomplete="off" aria-label="${car}番 選手名">
      <input class="ri-score" type="text" inputmode="decimal" placeholder="得点" aria-label="${car}番 競走得点">
      <select class="ri-style" aria-label="${car}番 脚質">
        <option value="">脚質</option>
        ${Object.values(STYLE).map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <input class="ri-back" type="text" inputmode="numeric" placeholder="B" aria-label="${car}番 バック回数">
      <input class="ri-start" type="text" inputmode="numeric" placeholder="S" aria-label="${car}番 S回数">
    </div>`;

  container.innerHTML = `
    <div class="ri-venue">
      <label>競輪場
        <select class="ri-venue-name" aria-label="競輪場">
          <option value="">選ばない (400バンク)</option>
          ${VENUES.map(v => `<option value="${esc(v.name)}">${esc(v.name)} (${v.bank === 333 ? '333' : v.bank})</option>`).join('')}
        </select>
      </label>
      <label>R <input class="ri-race-no" type="text" inputmode="numeric" placeholder="11" aria-label="レース番号"></label>
    </div>
    <p class="ri-help ri-bank-note"></p>
    <p class="ri-help">名前か得点を入れた車番だけが出走します。B=バック回数、S=S回数(分からなければ空欄で大丈夫)。</p>
    <div class="ri-head"><span>車</span><span>選手名</span><span>得点</span><span>脚質</span><span>B</span><span>S</span></div>
    <div class="ri-rows">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(rowHtml).join('')}</div>
    <label class="ri-lines-label">並び (周回の前から)
      <input class="ri-lines" type="text" inputmode="none" autocomplete="off" placeholder="下のボタンで入力 例: 123/456/789">
    </label>
    <div class="ri-keypad" aria-label="並びの入力ボタン">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" class="ri-key car-${n}" data-key="${n}">${n}</button>`).join('')}
      <button type="button" class="ri-key ri-key-sep" data-key="/">区切り /</button>
      <button type="button" class="ri-key ri-key-back" data-key="back">1文字消す</button>
      <button type="button" class="ri-key ri-key-clear" data-key="clear">並びを消す</button>
    </div>
    <p class="ri-help">ラインの区切りは「区切り /」。単騎の選手は1人だけで区切ります (例: 12/45/7/89)。</p>
    <label class="ri-check"><input class="ri-auto" type="checkbox"> ラインの前後の順番はAIに任せる</label>
    <div class="ri-errors" role="alert"></div>
    <div class="ri-actions">
      <button type="button" class="primary-btn ri-apply">この出走表で予想する</button>
      <button type="button" class="secondary-btn ri-sample">サンプルを入れる</button>
      <button type="button" class="secondary-btn ri-clear">全部消す</button>
    </div>
    <details class="ri-json">
      <summary>データを貼り付けて読み込む</summary>
      <p class="ri-help">Claudeに出走表のスクショを渡して作ってもらったデータは、ここに貼り付けると読み込めます。</p>
      <textarea class="ri-json-text" rows="5" spellcheck="false" placeholder='{"riders":[...],"lines":[[1,2,3],...]}'></textarea>
      <button type="button" class="secondary-btn ri-json-load">貼り付けたデータを読み込む</button>
    </details>`;

  const $ = sel => container.querySelector(sel);
  let current = null; // 最後に走らせたレースデータ
  const rows = [...container.querySelectorAll('.ri-row')];
  container.querySelector('.ri-venue-name').addEventListener('change', () => bankNote());
  const errorsBox = $('.ri-errors');

  const read = () => {
    const riders = [];
    for (const row of rows) {
      const car = Number(row.dataset.car);
      const name = row.querySelector('.ri-name').value.trim();
      const score = row.querySelector('.ri-score').value.trim();
      if (!name && !score) continue;
      riders.push({
        car, name, score: score === '' ? undefined : Number(score.replace(/[^\d.]/g, '')),
        style: row.querySelector('.ri-style').value || undefined,
        back: row.querySelector('.ri-back').value.trim() === '' ? undefined : Number(row.querySelector('.ri-back').value),
        start: row.querySelector('.ri-start').value.trim() === '' ? undefined : Number(row.querySelector('.ri-start').value)
      });
    }
    // 展開の指定(戦法・前受けの対応)は「展開を選ぶ」で付けたものを引き継ぐ
    const venue = $('.ri-venue-name').value, raceNo = Number($('.ri-race-no').value) || undefined;
    return { race: { ...(current?.race ?? {}), venue: venue || undefined, raceNo }, bank: bankOfVenue(venue) ?? undefined, riders, lines: parseLines($('.ri-lines').value), autoFormation: $('.ri-auto').checked,
      tactics: { ...(current?.tactics ?? {}) }, frontResponse: { ...(current?.frontResponse ?? {}) } };
  };

  const bankNote = () => {
    const b = bankOfVenue($('.ri-venue-name').value) ?? 400;
    $('.ri-bank-note').textContent = b === 333 ? '333バンク: 直線が短く、逃げ・先行が残りやすい' : b === 500 ? '500バンク: 直線が長く、差し・追い込みが届きやすい' : '400バンク';
  };
  const fill = data => {
    $('.ri-venue-name').value = data?.race?.venue ?? '';
    $('.ri-race-no').value = data?.race?.raceNo ?? '';
    bankNote();
    for (const row of rows) {
      const r = (data?.riders ?? []).find(x => Number(x.car) === Number(row.dataset.car)) ?? {};
      row.querySelector('.ri-name').value = r.name ?? '';
      row.querySelector('.ri-score').value = r.score ?? '';
      row.querySelector('.ri-style').value = r.style ?? '';
      row.querySelector('.ri-back').value = r.back ?? '';
      row.querySelector('.ri-start').value = r.start ?? '';
    }
    $('.ri-lines').value = formatLines(data?.lines);
    $('.ri-auto').checked = !!data?.autoFormation;
  };

  const showErrors = list => {
    errorsBox.innerHTML = list.length ? `<ul>${list.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  };

  const apply = data => {
    const errors = validateRaceData(data);
    showErrors(errors);
    if (errors.length) return false;
    save(data);
    current = structuredClone(data);
    onApply(toRaceSetup(data), data);
    return true;
  };

  // 並びの専用キー: iPhoneの数字キーボードにはスラッシュが無いので、画面上のボタンで入力する
  const linesInput = $('.ri-lines');
  container.querySelector('.ri-keypad').addEventListener('click', event => {
    const key = event.target.closest('[data-key]')?.dataset.key;
    if (!key) return;
    let v = linesInput.value.replace(/\s+/g, '');
    if (key === 'back') v = v.slice(0, -1);
    else if (key === 'clear') v = '';
    else if (key === '/') { if (v && !v.endsWith('/')) v += '/'; }
    else if (!v.includes(key)) v += key; // 同じ車番は2回入れない
    linesInput.value = v.split('/').join(' / ');
  });

  $('.ri-apply').addEventListener('click', () => {
    if (apply(read())) container.closest('details')?.removeAttribute('open');
  });
  $('.ri-sample').addEventListener('click', () => { fill(SAMPLE_RACE_DATA); showErrors([]); });
  $('.ri-clear').addEventListener('click', () => { fill({ riders: [], lines: [] }); showErrors([]); });
  $('.ri-json-load').addEventListener('click', () => {
    try {
      const data = JSON.parse($('.ri-json-text').value);
      fill(data);
      if (apply({ ...data, lines: (data.lines ?? []).map(l => l.map(Number)) })) container.closest('details')?.removeAttribute('open');
    } catch {
      showErrors(['貼り付けたデータを読めませんでした。全部コピーできているか確認してください']);
    }
  });

  // 前回入力した出走表があれば、それで始める (なければサンプル)
  // 共有リンクで開いたらそのレース、なければ前回の出走表、それもなければサンプル
  const linked = fromLink();
  const saved = linked && !validateRaceData(linked).length ? linked : load();
  const start = saved && !validateRaceData(saved).length ? saved : structuredClone(SAMPLE_RACE_DATA);
  fill(start);
  apply(start);

  return {
    getData: () => structuredClone(current),
    apply: data => { fill(data); return apply(data); }
  };
}
