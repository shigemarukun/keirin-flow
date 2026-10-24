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
