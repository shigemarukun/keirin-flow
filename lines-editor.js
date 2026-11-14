// KEIRIN FLOW — 並びを変える
//
// 「誰と誰がラインか」「ラインの中の順番 (先頭・番手・3番手)」「どのラインが前か (周回の位置)」を、
// 1つの画面でまとめて変える。決定したらすぐ予想し直す。
//   選手をタップ → くっつけたい選手をタップ … その選手の後ろに付ける (同じラインなら順番を入れ替え)
//   選んだ選手の「単騎にする」… ラインから外す
//   ▲▼ … ラインの前後 (周回の位置) を入れ替え
//   文字で「1-2 / 4-6 / 5-3-7」と打っても直せる
import { openSheet, closeSheet } from './glossary.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const linesText = groups => groups.map(g => g.join('-')).join(' / ');

// 並びの操作 (画面と切り離して、テストできるように)
export const LineOps = {
  // a を b の後ろに付ける。同じラインなら a と b の順番を入れ替える
  join(groups, a, b) {
    const gs = groups.map(g => [...g]);
    const ga = gs.find(g => g.includes(a)), gb = gs.find(g => g.includes(b));
    if (!ga || !gb || a === b) return gs;
    if (ga === gb) { const i = ga.indexOf(a), j = ga.indexOf(b); [ga[i], ga[j]] = [ga[j], ga[i]]; return gs; }
    ga.splice(ga.indexOf(a), 1);
    gb.splice(gb.indexOf(b) + 1, 0, a);
    return gs.filter(g => g.length);
  },
  // a をラインから外して単騎に (元のラインのすぐ後ろの位置に置く)
  solo(groups, a) {
    const gs = groups.map(g => [...g]);
    const i = gs.findIndex(g => g.includes(a));
    if (i < 0 || gs[i].length === 1) return gs;
    gs[i].splice(gs[i].indexOf(a), 1);
    gs.splice(i + 1, 0, [a]);
    return gs;
  },
  move(groups, i, dir) {
    const gs = groups.map(g => [...g]); const j = i + dir;
    if (j < 0 || j >= gs.length) return gs;
    [gs[i], gs[j]] = [gs[j], gs[i]];
    return gs;
  },
  // 全員がちょうど1回ずつ入っているか
  valid(groups, cars) {
    const flat = groups.flat();
    return flat.length === cars.length && new Set(flat).size === flat.length && cars.every(c => flat.includes(c));
  }
};

export function openLinesEditor({ data, formation, onSave }) {
  if (!data?.riders?.length) return;
  const cars = data.riders.map(r => Number(r.car)).sort((a, b) => a - b);
  const names = Object.fromEntries(data.riders.map(r => [Number(r.car), String(r.name ?? '').replace(/\s/g, '')]));
  const girls = !!(data.race?.girls || data.race?.grade === 'L');
  // いまの並び (AIが周回の位置を決めていれば、その並びから)
  let groups = (formation?.length ? formation : data.lines ?? []).map(g => [...g]);
  if (!LineOps.valid(groups, cars)) {
    const used = new Set(groups.flat());
    groups = [...groups.filter(g => g.length), ...cars.filter(c => !used.has(c)).map(c => [c])];
  }
  if (girls) groups = groups.flat().map(c => [c]);
  const original = linesText(groups);
  let sel = null, msg = '';

  const posLabel = (g, k) => g.length === 1 ? '単騎' : ['先頭', '番手', '3番手', '4番手'][k] ?? '';
  const html = () => `
    <p class="le-help">${girls ? 'ガールズはラインがないので、周回の順番 (前から) だけを変えます。▲▼で入れ替えてください。' : '<b>選手をタップ → くっつけたい選手をタップ</b>で、その選手の後ろに付きます (同じラインなら順番が入れ替わります)。ラインの前後 (周回の位置) は ▲▼ で。'}</p>
    <ol class="le-groups">${groups.map((g, i) => `
      <li class="le-group${g.length === 1 ? ' is-solo' : ''}">
        <span class="le-pos">${i === 0 ? '前' : i === groups.length - 1 ? '後ろ' : '中'}</span>
        <div class="le-riders">${g.map((c, k) => `
          <button type="button" class="le-rider${sel === c ? ' is-sel' : ''}" data-car="${c}" aria-pressed="${sel === c}">
            <span class="lg-car car-${c}">${c}</span><span class="le-name">${esc(names[c] ?? '')}</span><small>${posLabel(g, k)}</small>
          </button>`).join('<span class="le-dash">-</span>')}</div>
        <span class="le-move">
          <button type="button" class="le-mv" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="前へ">▲</button>
          <button type="button" class="le-mv" data-i="${i}" data-dir="1" ${i === groups.length - 1 ? 'disabled' : ''} aria-label="後ろへ">▼</button>
        </span>
      </li>`).join('')}</ol>
    ${sel != null && !girls ? `<div class="le-selbar"><span>${sel}番 ${esc(names[sel] ?? '')} を選択中 → くっつけたい選手をタップ</span>
      ${groups.find(g => g.includes(sel))?.length > 1 ? '<button type="button" class="secondary-btn le-solo">単騎にする</button>' : ''}
      <button type="button" class="le-cancel">選択をやめる</button></div>` : ''}
    <label class="le-text-label">文字で直す <small>例: 1-2 / 4-6 / 5-3-7 (前のラインから)</small>
      <input class="le-text" type="text" inputmode="text" autocomplete="off" value="${esc(linesText(groups))}"></label>
    ${msg ? `<p class="le-msg" role="status">${esc(msg)}</p>` : ''}
    <div class="le-actions">
      <button type="button" class="primary-btn le-save" ${linesText(groups) === original ? 'disabled' : ''}>この並びで予想する</button>
      <button type="button" class="secondary-btn le-reset" ${linesText(groups) === original ? 'disabled' : ''}>元に戻す</button>
    </div>`;

  const sheet = document.getElementById('sheet');
  const content = sheet.querySelector('.sheet-content');
  const render = () => { content.innerHTML = html(); };
  openSheet('並びを変える', html(), 'lines');

  const onClick = event => {
    if (sheet.dataset.mode !== 'lines') return;
    const mv = event.target.closest('.le-mv');
    if (mv) { groups = LineOps.move(groups, Number(mv.dataset.i), Number(mv.dataset.dir)); msg = ''; render(); return; }
    const r = event.target.closest('.le-rider');
    if (r) {
      const c = Number(r.dataset.car);
      if (girls) return;
      if (sel == null || sel === c) sel = sel === c ? null : c;
      else { groups = LineOps.join(groups, sel, c); sel = null; msg = ''; }
      render(); return;
    }
    if (event.target.closest('.le-solo')) { groups = LineOps.solo(groups, sel); sel = null; render(); return; }
    if (event.target.closest('.le-cancel')) { sel = null; render(); return; }
    if (event.target.closest('.le-reset')) { groups = original.split(' / ').map(g => g.split('-').map(Number)); sel = null; msg = ''; render(); return; }
    if (event.target.closest('.le-save')) {
      const ok = onSave(groups.map(g => [...g]));
      if (ok === false) { msg = 'この並びではレースを組めませんでした。全員が1回ずつ入っているか確かめてください'; render(); return; }
      cleanup(); closeSheet();
    }
  };
  const onChange = event => {
    if (sheet.dataset.mode !== 'lines' || !event.target.closest('.le-text')) return;
    const v = event.target.value;
    const gs = v.split(/[\/／|｜、,]+/).map(x => (x.match(/[1-9]/g) ?? []).map(Number)).filter(g => g.length);
    if (LineOps.valid(gs, cars)) { groups = girls ? gs.flat().map(c => [c]) : gs; sel = null; msg = ''; }
    else msg = `全員 (${cars.join('・')}番) を1回ずつ入れてください`;
    render();
  };
  const cleanup = () => { sheet.removeEventListener('click', onClick); content.removeEventListener('change', onChange); obs.disconnect(); };
  // 閉じられたら (×・外側・Esc・用語の説明に切り替え) 片付ける
  const obs = new MutationObserver(() => { if (sheet.hidden || sheet.dataset.mode !== 'lines') cleanup(); });
  obs.observe(sheet, { attributes: true, attributeFilter: ['hidden', 'data-mode'] });
  sheet.addEventListener('click', onClick);
  content.addEventListener('change', onChange);
}
