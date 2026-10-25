// KEIRIN FLOW — 展開をタップで選ぶ
// ライン先頭(と自力の単騎)ごとに 戦法 を、前受けの先頭には 突っ張る / 出させる を選べる。
// 選ぶとすぐにレースを組み直す。「おまかせ」はAIが能力から決めたもの。

import { RaceAI, TACTICS, TACTIC_LABEL } from './race-ai.js';
import { parseTenkaiText, applyTenkai } from './tenkai-text.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ai = new RaceAI();

// 文章などで付けた細かい指定 (仕掛けどころ・番手捲り・切り替え …) を一覧で見せる
const remLabel = rem => rem >= 1100 ? '青板' : rem >= 740 ? '赤板' : rem >= 620 ? '打鐘の前' : rem >= 570 ? '打鐘' : rem >= 450 ? '打鐘過ぎ' : rem >= 390 ? '最終ホーム' : rem >= 280 ? '1〜2コーナー' : rem >= 170 ? '最終バック' : rem >= 85 ? '3〜4コーナー' : '最後の直線';
function detailHtml(data) {
  const items = [];
  for (const [car, o] of Object.entries(data.tenkai ?? {})) {
    if (o.strike != null) items.push(`${car}番: 仕掛けは${remLabel(o.strike)}から`);
    if (o.banteMakuri != null) items.push(`${car}番: 番手捲り (${remLabel(o.banteMakuri)})`);
    if (o.switchTo) items.push(`${car}番: ${o.switchTo}番へ切り替え`);
    if (o.tobitsuki) items.push(`${car}番: ${typeof o.tobitsuki === 'number' ? `${o.tobitsuki}番に` : ''}飛びつき`);
    if (o.noBlock) items.push(`${car}番: ブロックしない`);
    if (o.cutPacer) items.push(`${car}番: 誘導切りに行く`);
  }
  return items.length ? `<div class="tp-group"><div class="tp-title"><strong>細かい指定</strong><span>文章で書いた展開から</span></div><ul class="tp-detail">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
}

// ---------- 文章で展開を書く ----------
// 「7番が打鐘でカマして、棚瀬は引いて巻き返し」のように書くと、書いているそばから読み取った内容を見せ、
// 「この展開で走らせる」でレースを組み直す。何を書けばいいか迷わないよう、この出走表の選手名で例を出す
const CAR_BG = { 1: '#ffffff', 2: '#222222', 3: '#e60012', 4: '#0068b7', 5: '#ffd400', 6: '#00a651', 7: '#f08300', 8: '#ff69b4', 9: '#7f3fbf' };
const CAR_FG = { 1: '#111', 2: '#fff', 3: '#fff', 4: '#fff', 5: '#111', 6: '#fff', 7: '#111', 8: '#111', 9: '#fff' };
const carChip = n => `<span class="tt-car" style="background:${CAR_BG[n]};color:${CAR_FG[n]}">${n}</span>`;

function suggestions(data) {
  const lines = (data?.lines ?? []).filter(g => g.length);
  // 呼び名: 姓 (先頭2〜3文字)。ほかの選手と同じになる (例: サンプルの「選手A」「選手B」) なら車番で
  const full = car => String(data.riders.find(x => Number(x.car) === car)?.name ?? '').replace(/\s/g, '');
  const name = car => {
    const n = full(car); if (!n) return `${car}番`;
    const short = n.slice(0, Math.min(3, Math.max(2, n.length - 2)));
    return data.riders.some(x => Number(x.car) !== car && full(Number(x.car)).startsWith(short)) ? `${car}番` : short;
  };
  const leaders = lines.map(g => g[0]);
  const withBante = lines.filter(g => g.length >= 2);
  const out = [];
  if (leaders[1]) out.push(`${name(leaders[1])}が打鐘でカマす`);
  if (leaders[0]) out.push(`${name(leaders[0])}は引いて巻き返し`);
  if (leaders[0]) out.push(`${name(leaders[0])}が突っ張り先行`);
  if (leaders[2]) out.push(`${name(leaders[2])}は中団から捲り`);
  if (leaders[2]) out.push(`${name(leaders[2])}が赤板で誘導切り`);
  if (withBante[0]) out.push(`${name(withBante[0][1])}がバックで番手捲り`);
  if (leaders[3] ?? leaders[1]) out.push(`${name(leaders[3] ?? leaders[1])}はロング捲り`);
  if (leaders[1]) out.push(`${name(leaders[1])}ラインが前受け`);
  return out;
}

// 同じ選手の読み取りは1行にまとめ、名前を添える
function grouped(readings, data) {
  const out = [];
  for (const r of readings) {
    const g = out.find(x => x.car === r.car) ?? (out.push({ car: r.car, texts: [], name: r.car ? String(data.riders.find(x => Number(x.car) === r.car)?.name ?? '').replace(/\s/g, '') : '' }), out[out.length - 1]);
    const t = r.text.replace(/^\d番: /, '').replace(/^\d+のライン: /, 'ライン: ');
    if (!g.texts.includes(t)) g.texts.push(t);
  }
  return out;
}

export function mountTenkaiTextPanel(container, { getData, apply }) {
  if (!container) return { render() {} };
  let last = null, timer = null;
  container.innerHTML = `
    <div class="tt-box">
      <div class="tt-head"><strong>自分の展開を文章で書く</strong><small>書いたそばからAIが読み取ります。iPhoneのマイクで話してもOK</small></div>
      <textarea class="tt-text" rows="3" placeholder="例: 佐藤が打鐘でカマして、棚瀬は引いて巻き返し。長尾がバックで番手捲り"></textarea>
      <div class="tt-sugs" aria-label="例をタップで足す"></div>
      <div class="tt-out" role="status"></div>
      <div class="tt-actions">
        <button type="button" class="primary-btn tt-apply" disabled>この展開で予想し直す</button>
        <button type="button" class="secondary-btn tt-clear">消す</button>
      </div>
      <details class="tt-help"><summary>使える言葉</summary>
        <p class="tp-note">選手: 車番 (5番・⑤・5号車)・名前 (久田・久田君)・ライン (7番ライン・九州ライン・関東の3番手・4-3-8)<br>
        戦法: 先行・逃げ・主導権・徹底先行・抑え先行・叩く・カマシ・一気・捲り・ロング捲り・捲り追い込み・一発・追込・差し・脚を溜める<br>
        前受け: 突っ張る (出させない・引かない)・引く (下げる・巻き返し)・中団 (入れる・出させる)<br>
        ラインの動き: 前受け・前々・後ろ攻め・中団から・誘導切り (インを斬る・抑える)・二段駆け・番手捲り・自力に切り替え・切り替え・飛びつき・番手を競る・ブロック/張る/牽制 (しない)<br>
        場所: 赤板・打鐘 (ジャン)・打鐘過ぎ・最終ホーム・1角・2角・バック・3角・2センター・4角・直線・残り300m・早め・遅め<br>
        「逃げ切る」「千切れる」のような結果の言葉は、レースの中で決まるので指定には使いません。</p>
      </details>
    </div>`;
  const $ = sel => container.querySelector(sel);
  let showAll = false;
  const renderSugs = () => {
    const data = getData(); if (!data) return;
    const used = $('.tt-text').value;
    const list = suggestions(data).filter(t => !used.includes(t));
    const shown = showAll ? list : list.slice(0, 4);
    $('.tt-sugs').innerHTML = (shown.length ? '<span class="tt-sugs-label">例をタップ</span>' : '') + shown.map(t => `<button type="button" class="tt-sug">${esc(t)}</button>`).join('')
      + (!showAll && list.length > 4 ? '<button type="button" class="tt-more">ほかの例</button>' : '');
  };
  const read = () => {
    const data = getData(); if (!data) return;
    const text = $('.tt-text').value;
    if (!text.trim()) { last = null; $('.tt-out').innerHTML = ''; $('.tt-apply').disabled = true; return; }
    last = parseTenkaiText(text, data);
    const { readings, unknown, outcomes } = last;
    $('.tt-out').innerHTML = `
      ${readings.length ? `<div class="fc-label">AIの読み取り</div><ul class="tt-list">${grouped(readings, data).map(g => `<li>${g.car ? carChip(g.car) : '<span class="tt-car tt-car-all">並</span>'}<span>${g.name ? `<b>${esc(g.name)}</b> ` : ''}${g.texts.map(esc).join(' / ')}</span></li>`).join('')}</ul>` : '<p class="ri-help">まだ展開の指定が読み取れていません。上の例をタップすると、書き方が分かります。</p>'}
      ${unknown.length ? `<p class="ri-warn">分からなかったところ: ${unknown.map(esc).join(' / ')}</p>` : ''}
      ${outcomes.length ? `<p class="ri-help">「${outcomes.map(esc).join('」「')}」は結果の言葉なので、指定には使いません (結果はレースの中で決まります)。</p>` : ''}`;
    $('.tt-apply').disabled = !readings.length;
  };
  $('.tt-text').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(read, 250); });
  $('.tt-sugs').addEventListener('click', e => {
    if (e.target.closest('.tt-more')) { showAll = true; renderSugs(); return; }
    const b = e.target.closest('.tt-sug'); if (!b) return;
    const t = $('.tt-text'); t.value = (t.value.trim() ? `${t.value.trim().replace(/[。、]$/, '')}。` : '') + b.textContent;
    read(); renderSugs();
  });
  $('.tt-clear').addEventListener('click', () => { $('.tt-text').value = ''; read(); renderSugs(); });
  $('.tt-apply').addEventListener('click', () => {
    read();
    const data = getData(); if (!data || !last) return;
    const next = applyTenkai(data, last.changes);
    next.tenkaiText = $('.tt-text').value;
    const ok = apply(next);
    if (ok === false) { $('.tt-out').insertAdjacentHTML('beforeend', '<p class="ri-warn">この指定ではレースを組めませんでした (並びなどを確かめてください)。</p>'); return; }
    // 結果 (AIの展開予想) へ移動して、組み直した展開を見せる
    document.querySelector('.forecast-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return {
    render() {
      const d = getData();
      if (d?.tenkaiText != null && !$('.tt-text').value) $('.tt-text').value = d.tenkaiText;
      renderSugs(); if ($('.tt-text').value) read();
    }
  };
}

export function mountTacticsPanel(container, { getData, apply, getSetup, getPrediction }) {
  if (!container) return { render() {} };

  const render = () => {
    const data = getData(), setup = getSetup(), prediction = getPrediction();
    if (!data || !setup) { container.innerHTML = ''; return; }
    const names = setup.meta?.names ?? {};
    const groups = setup.formation?.length ? setup.formation : setup.lines.map(l => l.members);
    const frontLeader = groups[0]?.[0];

    const chip = (car, kind, value, label, selected) =>
      `<button type="button" class="tp-chip${selected ? ' is-on' : ''}" data-car="${car}" data-kind="${kind}" data-value="${value}" aria-pressed="${selected}">${esc(label)}</button>`;

    container.innerHTML = groups.map((group, index) => {
      const leader = group[0];
      const rider = setup.riders[leader];
      if (!rider) return '';
      const solo = group.length === 1;
      const aiStyle = TACTIC_LABEL[ai.styleOf({ profile: rider, mindset: rider.mindset })];
      const tactic = data.tactics?.[leader] ?? '';
      const title = solo ? `単騎 <b>${leader}</b>` : `ライン${index + 1} <b>${group.join('-')}</b>`;
      let html = `
        <div class="tp-group">
          <div class="tp-title">
            <strong>${title}</strong><span>${esc(names[leader] ?? '')}${solo ? '' : ' が先頭'}</span>
            <span class="tp-move">
              <button type="button" class="tp-move-btn" data-move="up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="前へ">▲</button>
              <button type="button" class="tp-move-btn" data-move="down" data-index="${index}" ${index === groups.length - 1 ? 'disabled' : ''} aria-label="後ろへ">▼</button>
            </span>
          </div>
          <div class="tp-chips">
            ${chip(leader, 'tactic', '', `おまかせ(${aiStyle})`, !tactic)}
            ${TACTICS.map(t => chip(leader, 'tactic', t, TACTIC_LABEL[t], tactic === t)).join('')}
          </div>`;
      if (solo) {
        // 単騎は「◯番のラインの番手を競る」も選べる
        const targets = groups.filter(g => g.length > 1).map(g => g[0]);
        if (targets.length) {
          html += `
          <div class="tp-sub">番手を競る (単騎で他のラインの2番手を取りに行く)</div>
          <div class="tp-chips">
            ${targets.map(t => chip(leader, 'tactic', `SERI:${t}`, `${t}番の番手を競る`, tactic === `SERI:${t}`)).join('')}
          </div>`;
        }
      }
      if (leader === frontLeader) {
        // AIのおすすめ (指定を外したときの対応): 前受けの性格から
        // AIのおすすめ: EXデータ(突っ張りの回数など)や脚質から出した割合。おまかせなら、何通りもの未来でこの割合で選ぶ
        const probs = rider.frontPlanFromEx ? (rider.frontPlanProbs ?? {}) : {};
        const pct = v => (v == null ? '' : `${Math.round(v * 100)}%`);
        const front = data.frontResponse?.[leader] === 'YIELD' ? 'CHUDAN' : (data.frontResponse?.[leader] ?? '');
        html += `
          <div class="tp-sub">前受けで、誘導切りに来られたら</div>
          <div class="tp-chips">
            ${chip(leader, 'front', '', rider.frontPlanFromEx ? 'おまかせ' : 'おまかせ(相手次第)', !front)}
            ${chip(leader, 'front', 'TSUPPARI', `突っ張る ${pct(probs.TSUPPARI)}`, front === 'TSUPPARI')}
            ${chip(leader, 'front', 'HIKU', `引く ${pct(probs.HIKU)}`, front === 'HIKU')}
            ${chip(leader, 'front', 'CHUDAN', `中団 ${pct(probs.CHUDAN)}`, front === 'CHUDAN')}
          </div>
          <p class="tp-note">${rider.frontPlanFromEx ? '%はEXデータ(突っ張りの回数など)から見た割合。おまかせなら、何通りもの未来でこの割合で選びます。' : 'EXデータが無いので、おまかせなら誘導切りに来た相手と力を比べて決めます。'} 引く=後方まで下げて巻き返す / 中団=前に入れたラインの後ろを取る</p>`;
      }
      return html + '</div>';
    }).join('') + detailHtml(data) + `<button type="button" class="secondary-btn tp-reset">展開の指定をすべておまかせに戻す</button>`;
  };

  container.addEventListener('click', event => {
    const data = getData();
    if (!data) return;
    const move = event.target.closest('.tp-move-btn');
    if (move) {
      // 周回の並び順 (どのラインが前か) を入れ替える
      const setup = getSetup();
      const groups = (setup.formation?.length ? setup.formation : setup.lines.map(l => l.members)).map(g => [...g]);
      const i = Number(move.dataset.index), j = move.dataset.move === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= groups.length) return;
      [groups[i], groups[j]] = [groups[j], groups[i]];
      data.lines = groups; data.autoFormation = false;
    } else if (event.target.closest('.tp-reset')) {
      data.tactics = {}; data.frontResponse = {}; data.tenkai = {};
    } else {
      const b = event.target.closest('.tp-chip');
      if (!b) return;
      const key = b.dataset.kind === 'tactic' ? 'tactics' : 'frontResponse';
      data[key] = { ...(data[key] ?? {}) };
      if (b.dataset.value) data[key][b.dataset.car] = b.dataset.value;
      else delete data[key][b.dataset.car];
    }
    apply(data);
    render();
  });

  return { render };
}
