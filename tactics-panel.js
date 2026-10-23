// KEIRIN FLOW — 展開をタップで選ぶ
// ライン先頭(と自力の単騎)ごとに 戦法 を、前受けの先頭には 突っ張る / 出させる を選べる。
// 選ぶとすぐにレースを組み直す。「おまかせ」はAIが能力から決めたもの。

import { RaceAI, TACTICS, TACTIC_LABEL } from './race-ai.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ai = new RaceAI();

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
      if (leader === frontLeader) {
        // AIのおすすめ (指定を外したときの対応): 前受けの性格から
        const aiFront = rider.mindset === 'TSUPPARI' ? '突っ張り' : rider.mindset === 'YIELD_AND_ROLL' ? '出させる' : '相手次第';
        const front = data.frontResponse?.[leader] ?? '';
        html += `
          <div class="tp-sub">前受けで、誘導切りに来られたら</div>
          <div class="tp-chips">
            ${chip(leader, 'front', '', `おまかせ(${aiFront})`, !front)}
            ${chip(leader, 'front', 'TSUPPARI', '突っ張る', front === 'TSUPPARI')}
            ${chip(leader, 'front', 'YIELD', '出させる', front === 'YIELD')}
          </div>`;
      }
      return html + '</div>';
    }).join('') + `<button type="button" class="secondary-btn tp-reset">展開の指定をすべておまかせに戻す</button>`;
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
      data.tactics = {}; data.frontResponse = {};
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
