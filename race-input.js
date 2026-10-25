// KEIRIN FLOW — 出走表の手入力画面
// 入力された出走表を「レースデータ」(race-data.js) にして、シミュレーションへ渡す。

import { STYLE, VENUES, KIMARITE_LABEL, CLASSES, RACE_GRADES, HISTORY, normalizeClass, parseRaceCardText, kimariteFromPercent, bankOfVenue, SAMPLE_RACE_DATA, parseLines, formatLines, validateRaceData, toRaceSetup } from './race-data.js';

const STORAGE_KEY = 'keirin-flow:race-input:v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 予想のリンク共有 ----------
// 出走表・並び・展開の指定を、短い名前に置き換えて圧縮し、URL の ?s= に入れる (サーバーは使わない)。
//   熊本8R (9人・決まり手・今開催成績つき) で 約3400文字 → 約700文字
// 以前の長いリンク (#r=) も、そのまま開ける。
const SHORT = { race: 'R', riders: 'P', car: 'c', name: 'n', pref: 'f', class: 'k', score: 's', style: 'y', back: 'b', start: 't', kimarite: 'm', nige: 'e', makuri: 'u', sashi: 'a', mark: 'q', meet: 'x', lines: 'L', venue: 'v', raceNo: 'o', grade: 'g', kind: 'd', tactics: 'T', frontResponse: 'F', autoFormation: 'A', history: 'h', bank: 'B', girls: 'G', ex: 'X', pos: 'z', stage: 'w' };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const rename = (v, map) => Array.isArray(v) ? v.map(x => rename(x, map)) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== '' && x !== null).map(([k, x]) => [map[k] ?? k, rename(x, map)])) : v;
const b64url = bytes => { let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = code => Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function encodeRaceData(data) {
  // 今開催成績は着順だけ (予選・選抜などの名前は省く)
  const slim = { ...data, riders: (data.riders ?? []).map(r => (r.meet ? { ...r, meet: r.meet.map(m => ({ pos: m.pos })) } : r)) };
  const bytes = new TextEncoder().encode(JSON.stringify(rename(slim, SHORT)));
  if (typeof CompressionStream === 'function') {
    try { return `2${b64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`; } catch { /* 圧縮できない端末は、そのまま */ }
  }
  return `1${b64url(bytes)}`;
}
export async function decodeRaceData(code) {
  const v = code[0], body = code.slice(1);
  if (v === '2') return rename(JSON.parse(new TextDecoder().decode(await pipe(unb64url(body), new DecompressionStream('deflate-raw')))), LONG);
  if (v === '1') return rename(JSON.parse(new TextDecoder().decode(unb64url(body))), LONG);
  return JSON.parse(new TextDecoder().decode(unb64url(code))); // 以前の長いリンク
}
export async function shareUrl(data) {
  return `${location.origin}${location.pathname}?s=${await encodeRaceData(data)}`;
}
// リンクから来たとき: ?s= (新しい短いリンク) か #r= (以前のリンク)
function linkCode() {
  return new URLSearchParams(location.search).get('s') ?? location.hash.match(/[#&]r=([A-Za-z0-9_-]+)/)?.[1] ?? null;
}
async function fromLink() {
  const code = linkCode();
  if (!code) return null;
  try {
    const data = await decodeRaceData(code);
    history.replaceState(null, '', location.pathname); // 一度読んだら URL から消す
    return data;
  } catch { return null; }
}

const RACES_KEY = 'keirin-flow:races:v1';
const loadRaces = () => { try { return JSON.parse(localStorage.getItem(RACES_KEY) || '[]'); } catch { return []; } };
const saveRaces = list => { try { localStorage.setItem(RACES_KEY, JSON.stringify(list)); } catch { /* 保存できなくても動く */ } };
// 同じレース = 競輪場・R・選手の顔ぶれが同じ (展開の指定を変えても同じレースとして上書き)
const raceId = d => [d?.race?.venue ?? '', d?.race?.raceNo ?? '', (d?.riders ?? []).map(r => `${r.car}${r.name ?? ''}`).join(',')].join('|');
const isSample = d => (d?.riders ?? []).some(r => /^選手[A-I]$/.test(r.name ?? ''));
export const raceLabelOf = d => [d?.race?.venue, d?.race?.raceNo ? `${d.race.raceNo}R` : ''].filter(Boolean).join(' ') || `${(d?.riders ?? [])[0]?.name ?? ''}ほか`;

function load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } }
function save(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* 保存できない環境でも動く */ } }

export function mountRaceInput(container, { onApply, onLinked, onPasted, onRacesChange }) {
  if (!container) return;

  const rowHtml = car => `
    <div class="ri-row" data-car="${car}">
      <span class="ri-car car-${car}">${car}</span>
      <input class="ri-name" type="text" placeholder="選手名" autocomplete="off" aria-label="${car}番 選手名">
      <select class="ri-class" aria-label="${car}番 級班">
        <option value="">級班</option>
        ${Object.keys(CLASSES).map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
      <input class="ri-score" type="text" inputmode="decimal" placeholder="得点" aria-label="${car}番 競走得点">
      <select class="ri-style" aria-label="${car}番 脚質">
        <option value="">脚質</option>
        ${Object.values(STYLE).map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <input class="ri-back" type="text" inputmode="numeric" placeholder="B" aria-label="${car}番 バック回数">
      <input class="ri-start" type="text" inputmode="numeric" placeholder="S" aria-label="${car}番 S回数">
    </div>`;

  container.innerHTML = `
    <section class="ri-paste">
      <p class="ri-help">出走表のページ (WINTICKET・KEIRIN.JP・netkeibaなど) の文字を、まるごとコピーして貼り付けてください。選手・級班・得点・脚質・並びを読み取って、すぐに予想します。</p>
      <textarea class="ri-paste-text" rows="4" spellcheck="false" placeholder="ここに出走表の文字を貼り付け"></textarea>
      <div class="ri-actions">
        <button type="button" class="primary-btn ri-paste-read">読み取って予想</button>
        <button type="button" class="secondary-btn ri-paste-clip">コピーした文字を貼る</button>
      </div>
      <div class="ri-paste-out" role="status"></div>
    </section>
    <details class="ri-edit">
    <summary class="ri-step">出走表を確認・手で入力する <small>読み取りの間違いを直すとき</small></summary>
    <div class="ri-venue">
      <label>競輪場
        <select class="ri-venue-name" aria-label="競輪場">
          <option value="">選ばない (400バンク)</option>
          ${VENUES.map(v => `<option value="${esc(v.name)}">${esc(v.name)} (${v.bank === 333 ? '333' : v.bank})</option>`).join('')}
        </select>
      </label>
      <label>R <input class="ri-race-no" type="text" inputmode="numeric" placeholder="11" aria-label="レース番号"></label>
    </div>
    <label class="ri-grade-label">レースのクラス
      <select class="ri-grade" aria-label="レースのクラス">
        <option value="">自動 (級班・得点から)</option>
        ${Object.entries(RACE_GRADES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </label>
    <p class="ri-help ri-grade-note"></p>
    <p class="ri-help ri-bank-note"></p>
    <p class="ri-help ri-ex-note"></p>
    <p class="ri-help">名前か得点を入れた車番だけが出走します。B=バック回数、S=S回数(分からなければ空欄で大丈夫)。</p>
    <div class="ri-head"><span>車</span><span>選手名</span><span>級班</span><span>得点</span><span>脚質</span><span>B</span><span>S</span></div>
    <div class="ri-rows">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(rowHtml).join('')}</div>
    <details class="ri-hist">
      <summary>経歴 (元SS・特別昇級など) <small>得点だけでは測れない選手</small></summary>
      <p class="ri-help">北井選手のように元S級でA級から走っている選手や、特別昇級・昇級したばかりの選手は、得点が本来の実力とずれています。ここで選ぶと補正します。</p>
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(car => `<div class="ri-hist-row" data-car="${car}"><span class="ri-car car-${car}">${car}</span><select class="ri-history" aria-label="${car}番 経歴"><option value="">なし (得点どおり)</option>${Object.entries(HISTORY).map(([k, h]) => `<option value="${k}">${h.label} — ${h.note}</option>`).join('')}</select></div>`).join('')}
    </details>
    <details class="ri-kim">
      <summary>決まり手 (逃・捲・差・マ) <small>入れると精度が上がります</small></summary>
      <p class="ri-help">選手の「決まり手」です。回数でも、WINTICKETの「連対時の決まり手」の % (例 19.0) でも大丈夫です。その選手が実際に逃げで勝つのか、捲りで勝つのかを走り方に反映します。脚質より実績を優先します。</p>
      <div class="ri-kim-head"><span>車</span>${Object.values(KIMARITE_LABEL).map(l => `<span>${l}</span>`).join('')}</div>
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(car => `<div class="ri-kim-row" data-car="${car}"><span class="ri-car car-${car}">${car}</span>${Object.entries(KIMARITE_LABEL).map(([k, l]) => `<input class="ri-k" data-k="${k}" type="text" inputmode="numeric" aria-label="${car}番 決まり手 ${l}">`).join('')}</div>`).join('')}
    </details>
    <label class="ri-lines-label"><span class="ri-lines-title">並び (周回の前から)</span>
      <input class="ri-lines" type="text" inputmode="none" autocomplete="off" placeholder="下のボタンで入力 例: 123/456/789">
    </label>
    <div class="ri-keypad" aria-label="並びの入力ボタン">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" class="ri-key car-${n}" data-key="${n}">${n}</button>`).join('')}
      <button type="button" class="ri-key ri-key-sep" data-key="/">区切り /</button>
      <button type="button" class="ri-key ri-key-back" data-key="back">1文字消す</button>
      <button type="button" class="ri-key ri-key-clear" data-key="clear">並びを消す</button>
    </div>
    <p class="ri-help ri-lines-help">ラインの区切りは「区切り /」。単騎の選手は1人だけで区切ります (例: 12/45/7/89)。</p>
    <label class="ri-check"><input class="ri-auto" type="checkbox"> ラインの前後の順番はAIに任せる</label>
    <div class="ri-errors" role="alert"></div>
    <div class="ri-actions">
      <button type="button" class="primary-btn ri-apply">この出走表で予想する</button>
      <button type="button" class="secondary-btn ri-sample">サンプルを入れる</button>
      <button type="button" class="secondary-btn ri-clear">全部消す</button>
    </div>
    </details>
`;

  const $ = sel => container.querySelector(sel);
  let current = null; // 最後に走らせたレースデータ
  // 表に欄がないデータ (EXデータ・府県・レース種別) は、読み取ったものをここに持っておき、予想するときに戻す
  let extras = { riders: {}, race: {} };
  const rows = [...container.querySelectorAll('.ri-row')];
  container.querySelector('.ri-venue-name').addEventListener('change', () => bankNote());
  const kimRow = car => container.querySelector(`.ri-kim-row[data-car="${car}"]`);
  // ガールズ: ラインがないので、並びは周回の前からの順番だけを入れる
  const girlsNote = () => {
    const grade = $('.ri-grade').value, g = grade === 'L';
    $('.ri-grade-note').textContent = g ? 'ガールズ: ラインなしの個人戦。ブロック・番手の競りはありません' : grade === 'C' ? 'チャレンジ: A級3班の7車立て' : '';
    $('.ri-auto').closest('label').hidden = g;
    $('.ri-lines-title').textContent = g ? '周回の並び順 (前から)' : '並び (周回の前から)';
    $('.ri-lines-help').textContent = g
      ? 'ガールズはラインがないので、区切りは不要です。周回の並び順を前から入れてください (例: 1234567)。'
      : 'ラインの区切りは「区切り /」。単騎の選手は1人だけで区切ります (例: 12/45/7/89)。';
  };
  container.querySelector('.ri-grade').addEventListener('change', () => girlsNote());
  const errorsBox = $('.ri-errors');

  const read = () => {
    const riders = [];
    for (const row of rows) {
      const car = Number(row.dataset.car);
      const name = row.querySelector('.ri-name').value.trim();
      const score = row.querySelector('.ri-score').value.trim();
      if (!name && !score) continue;
      const kim = {};
      // 回数(整数)でも、WINTICKETの % (小数・%付き) でも受け付ける
      for (const input of kimRow(car).querySelectorAll('.ri-k')) {
        const v = input.value.trim(); if (v === '') continue;
        const n = Number(v.replace(/[^\d.]/g, '')) || 0;
        kim[input.dataset.k] = /[.%]/.test(v) ? kimariteFromPercent(n) : n;
      }
      riders.push({
        ...(extras.riders[car] ?? {}),
        class: row.querySelector('.ri-class').value || undefined,
        history: container.querySelector(`.ri-hist-row[data-car="${car}"] .ri-history`).value || undefined,
        kimarite: Object.keys(kim).length ? kim : undefined,
        car, name, score: score === '' ? undefined : Number(score.replace(/[^\d.]/g, '')),
        style: row.querySelector('.ri-style').value || undefined,
        back: row.querySelector('.ri-back').value.trim() === '' ? undefined : Number(row.querySelector('.ri-back').value),
        start: row.querySelector('.ri-start').value.trim() === '' ? undefined : Number(row.querySelector('.ri-start').value)
      });
    }
    // 展開の指定(戦法・前受けの対応)は「展開を選ぶ」で付けたものを引き継ぐ
    const venue = $('.ri-venue-name').value, raceNo = Number($('.ri-race-no').value) || undefined;
    const grade = $('.ri-grade').value || undefined;
    return { race: { ...(current?.race ?? {}), ...extras.race, venue: venue || undefined, raceNo, grade, girls: grade === 'L' || undefined }, bank: bankOfVenue(venue) ?? undefined, riders, lines: parseLines($('.ri-lines').value), autoFormation: $('.ri-auto').checked,
      tactics: { ...(current?.tactics ?? {}) }, frontResponse: { ...(current?.frontResponse ?? {}) },
      tenkai: structuredClone(current?.tenkai ?? {}), tenkaiText: current?.tenkaiText };
  };

  const bankNote = () => {
    const b = bankOfVenue($('.ri-venue-name').value) ?? 400;
    $('.ri-bank-note').textContent = b === 333 ? '333バンク: 直線が短く、逃げ・先行が残りやすい' : b === 500 ? '500バンク: 直線が長く、差し・追い込みが届きやすい' : '400バンク';
  };
  const fill = data => {
    extras = {
      riders: Object.fromEntries((data?.riders ?? []).filter(r => r.ex || r.pref || r.meet).map(r => [Number(r.car), { ex: r.ex ?? undefined, pref: r.pref ?? undefined, meet: r.meet ?? undefined }])),
      race: { kind: data?.race?.kind ?? undefined, name: data?.race?.name ?? undefined }
    };
    const exN = Object.values(extras.riders).filter(x => x.ex).length;
    $('.ri-ex-note').textContent = exN ? `EXデータ: ${exN}人分あり (前受けの動き・千切れやすさ・得意な位置に反映します)` : '';
    $('.ri-venue-name').value = data?.race?.venue ?? '';
    $('.ri-race-no').value = data?.race?.raceNo ?? '';
    $('.ri-grade').value = (data?.girls ?? data?.race?.girls) ? 'L' : (data?.race?.grade ?? '');
    bankNote(); girlsNote();
    let anyKim = false, anyHist = false;
    for (const row of rows) {
      const r = (data?.riders ?? []).find(x => Number(x.car) === Number(row.dataset.car)) ?? {};
      row.querySelector('.ri-name').value = r.name ?? '';
      row.querySelector('.ri-score').value = r.score ?? '';
      row.querySelector('.ri-style').value = r.style ?? '';
      row.querySelector('.ri-back').value = r.back ?? '';
      row.querySelector('.ri-start').value = r.start ?? '';
      row.querySelector('.ri-class').value = normalizeClass(r.class) ?? '';
      const hs = container.querySelector(`.ri-hist-row[data-car="${row.dataset.car}"] .ri-history`);
      hs.value = HISTORY[r.history] ? r.history : '';
      if (hs.value) anyHist = true;
      for (const input of kimRow(row.dataset.car).querySelectorAll('.ri-k')) { input.value = r.kimarite?.[input.dataset.k] ?? ''; if (input.value !== '') anyKim = true; }
    }
    if (anyKim) $('.ri-kim').setAttribute('open', '');
    if (anyHist) $('.ri-hist').setAttribute('open', '');
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
    rememberRace(data);
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
    if (apply(read())) { $('.ri-edit').removeAttribute('open'); onPasted?.({ text: '出走表を入れ直して予想しました', warnings: [] }); }
  });
  $('.ri-sample').addEventListener('click', () => { fill(SAMPLE_RACE_DATA); showErrors([]); });
  $('.ri-clear').addEventListener('click', () => { fill({ riders: [], lines: [] }); showErrors([]); });
  // 出走表の文字を読み取る: 表に入れて、読めたもの・読めなかったものを知らせる (予想はボタンを押してから)
  const readPaste = () => {
    const text = $('.ri-paste-text').value;
    const out = $('.ri-paste-out');
    if (!text.trim()) { out.innerHTML = '<p class="ri-help">出走表の文字を貼り付けてください。</p>'; return; }
    const { data, found, warnings } = parseRaceCardText(text);
    if (!found.riders) { out.innerHTML = `<p class="ri-warn">${esc(warnings[0] ?? '読み取れませんでした')}</p>`; return; }
    const prev = read();
    fill({ ...data, race: { ...data.race, venue: data.race?.venue ?? prev.race.venue, raceNo: data.race?.raceNo ?? prev.race.raceNo },
      lines: data.lines?.length ? data.lines : [] });
    if (!data.lines?.length) $('.ri-lines').value = '';
    const list = data.riders.map(r => `<li><span class="ri-car car-${r.car}">${r.car}</span> ${esc(r.name ?? '')} ${esc(r.class ?? '—')} ${r.score ?? '—'} ${esc(r.style ?? '')}</li>`).join('');
    const summary = `${found.riders}人を読み取りました${found.lines && !found.linesPredicted ? '・並びも読み取りました' : found.linesPredicted ? '・並びは出走表に無かったので、府県と脚質からAIが推定しました' : ''}${found.ex ? `・EXデータ${found.ex}人分` : ''}`;
    showErrors([]);
    // 読み取れたら、そのまま予想する (足りないところがあれば、表を開いて直してもらう)
    const next = read();
    const errors = validateRaceData(next);
    if (!errors.length && apply(next)) {
      $('.ri-paste-text').value = '';
      out.innerHTML = '';
      onPasted?.({ text: summary, warnings });
      return;
    }
    out.innerHTML = `<p class="ri-ok">${esc(summary)}。足りないところがあるので、下の表を確認してから「この出走表で予想する」を押してください。</p>
      <ul class="ri-paste-list">${list}</ul>${warnings.map(w => `<p class="ri-warn">${esc(w)}</p>`).join('')}`;
    $('.ri-edit').setAttribute('open', '');
    showErrors(errors);
    $('.ri-edit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('.ri-paste-read').addEventListener('click', readPaste);
  $('.ri-paste-clip').addEventListener('click', async () => {
    try { $('.ri-paste-text').value = await navigator.clipboard.readText(); readPaste(); }
    catch { $('.ri-paste-out').innerHTML = '<p class="ri-help">この端末では自動で貼り付けできませんでした。上の枠を長押しして「ペースト」し、「読み取って予想」を押してください。</p>'; $('.ri-paste-text').focus(); }
  });

  // 前回入力した出走表があれば、それで始める (なければサンプル)
  // 共有リンクで開いたらそのレース、なければ前回の出走表、それもなければサンプル
  const saved = load();
  const start = saved && !validateRaceData(saved).length ? saved : structuredClone(SAMPLE_RACE_DATA);
  fill(start);
  apply(start);
  if (linkCode()) {
    // 送られてきたリンク: 中身を開いて、その出走表・並び・展開の指定で予想し直す
    fromLink().then(linked => {
      if (linked && !validateRaceData(linked).length) { fill(linked); apply(linked); onLinked?.(); }
      else $('.ri-paste-out').innerHTML = '<p class="ri-warn">送られてきたリンクを開けませんでした。リンクが途中で切れていないか確かめてください。</p>';
    });
  }

  return {
    getData: () => structuredClone(current),
    apply: data => { fill(data); return apply(data); },
    races: () => loadRaces(),
    currentId: () => (current ? raceId(current) : null),
    isSample: () => isSample(current),
    select: id => { const r = loadRaces().find(x => x.id === id); if (!r) return false; fill(r.data); return apply(r.data); },
    remove: id => { saveRaces(loadRaces().filter(x => x.id !== id)); onRacesChange?.(); },
    openPaste: () => { const d = container.closest('details'); d?.setAttribute('open', ''); d?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('.ri-paste-text').focus({ preventScroll: true }), 350); },
    pasteFromClipboard: async () => {
      try { const t = await navigator.clipboard.readText(); if (!t.trim()) throw new Error('empty'); $('.ri-paste-text').value = t; readPaste(); return true; }
      catch { return false; }
    }
  };

  // ---------- 今日のレース: 入れたレースを残して、タップで切り替える ----------
  function rememberRace(data) {
    if (isSample(data)) return;
    const id = raceId(data);
    // 並びは競輪場 → レース番号の順 (選び直しても順番が動かないように)
    let list = loadRaces();
    const item = { id, label: raceLabelOf(data), at: new Date().toISOString(), data: structuredClone(data) };
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list[i] = item; else list.push(item);
    // 多すぎたら古いものから消す
    if (list.length > 16) list = list.sort((a, b) => a.at.localeCompare(b.at)).slice(-16);
    list.sort((a, b) => String(a.data?.race?.venue ?? '').localeCompare(String(b.data?.race?.venue ?? ''), 'ja') || (Number(a.data?.race?.raceNo) || 99) - (Number(b.data?.race?.raceNo) || 99));
    saveRaces(list);
    onRacesChange?.();
  }
}
