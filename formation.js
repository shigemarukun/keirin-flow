// KEIRIN FLOW — 買い目をフォーメーション表記にまとめる
//
//   1-2-3, 1-2-4, 1-2-5, 1-3-2, 1-3-4, 1-3-5  →  1-23-2345 (6点)
//   1着12・2着全員・3着12                      →  12-全-12
//   3連複 1=2=3, 1=2=5, 1=3=5, 2=3=5           →  1235 BOX
// 買い目の点数は変えない (まとめた結果に、元に無い買い目が混ざらないようにする)。
// 着順どおりの券 (3連単・2車単) は「-」、順番を問わない券 (3連複・2車複・ワイド) は「=」でつなぐ。

const ORDERED = new Set(['trifecta', 'exacta']);

// 1つのフォーメーションが表す買い目 (同じ選手が2回出る組み合わせは除く)
function expand(sets, ordered) {
  const out = new Set();
  const rec = (i, cur) => {
    if (i === sets.length) { out.add(ordered ? cur.join('-') : [...cur].sort((a, b) => a - b).join('-')); return; }
    for (const c of sets[i]) if (!cur.includes(c)) rec(i + 1, [...cur, c]);
  };
  rec(0, []);
  return out;
}

// keys: ['1-2-3', …] (順番を問わない券は小さい順に並んだもの) / cars: 出走する車番 (「全」の判定用)
export function toFormations(keys, type, cars = []) {
  const ordered = ORDERED.has(type);
  const norm = k => { const a = k.split('-').map(Number); return ordered ? a.join('-') : [...a].sort((x, y) => x - y).join('-'); };
  let rest = new Set(keys.map(norm));
  const size = keys[0]?.split('-').length ?? 0;
  const all = [...new Set(cars.map(Number))].sort((a, b) => a - b);
  const out = [];
  // ボックス (選んだ選手の、すべての組み合わせ) にまとまるなら、まずそれ
  if (rest.size >= 3) {
    const members = [...new Set([...rest].flatMap(k => k.split('-').map(Number)))].sort((a, b) => a - b);
    const box = expand(Array(size).fill(members), ordered);
    if (box.size === rest.size && [...box].every(k => rest.has(k)) && members.length > size) {
      return [{ text: `${members.join('')} BOX`, points: box.size, keys: [...box] }];
    }
  }
  const candidates = all.length ? all : [...new Set([...rest].flatMap(k => k.split('-').map(Number)))];
  while (rest.size) {
    let best = null;
    for (const seed of rest) {
      const s0 = seed.split('-').map(Number);
      // 伸ばす順番を変えて試し、一番多くまとまったものを取る (3着→2着→1着 の順に流すのがふつう)
      for (const order of [[2, 1, 0], [1, 2, 0], [0, 1, 2], [2, 0, 1]].map(o => o.filter(i => i < size))) {
        const sets = s0.map(c => [c]);
        let grown = true, cur = expand(sets, ordered).size;
        while (grown) {
          grown = false;
          for (const i of order) for (const c of candidates) {
            if (sets[i].includes(c)) continue;
            const trial = sets.map((x, j) => (j === i ? [...x, c] : x));
            const ex = expand(trial, ordered);
            // 新しい買い目が増え、しかも全部が元の買い目に入っているときだけ広げる
            if (ex.size > cur && [...ex].every(k => rest.has(k))) { sets[i] = trial[i]; cur = ex.size; grown = true; }
          }
          // 1つずつでは広がらないとき、2つの着に同時に足してみる (例: 12-全-12 は 1着に2・3着に1 を一緒に足す)
          if (!grown) {
            outer: for (const i of order) for (const j of order) {
              if (j <= i) continue;
              for (const c of candidates) for (const d of candidates) {
                if (sets[i].includes(c) || sets[j].includes(d)) continue;
                const trial = sets.map((x, k) => (k === i ? [...x, c] : k === j ? [...x, d] : x));
                const ex = expand(trial, ordered);
                if (ex.size > cur && [...ex].every(k => rest.has(k))) { sets[i] = trial[i]; sets[j] = trial[j]; cur = ex.size; grown = true; break outer; }
              }
            }
          }
        }
        const ex = expand(sets, ordered);
        if (!best || ex.size > best.ex.size) best = { sets, ex };
      }
    }
    // ボックス (選んだ選手の組み合わせ全部) にまとまる部分があれば、同じ点数以上ならそちらを優先 (読みやすいので)
    const inRest = [...new Set([...rest].flatMap(k => k.split('-').map(Number)))];
    if (inRest.length <= 9) for (let mask = 1; mask < (1 << inRest.length); mask++) {
      const mem = inRest.filter((_, b) => mask & (1 << b));
      if (ordered ? mem.length < size : mem.length <= size) continue;
      const ex = expand(Array(size).fill(mem), ordered);
      if (ex.size >= best.ex.size && [...ex].every(k => rest.has(k))) best = { sets: Array(size).fill(mem), ex };
    }
    const sets = best.sets;
    // 「全」: その着に、残りの選手が全員入っている (ほかの着の選手は、どうせ同じ選手が2回になるので入れても同じ)
    const word = i => {
      const closure = new Set(sets[i]);
      for (const c of all) {
        if (closure.has(c)) continue;
        const trial = sets.map((x, j) => (j === i ? [...x, c] : x));
        if (expand(trial, ordered).size === best.ex.size) closure.add(c);
      }
      return all.length > 3 && closure.size === all.length && sets[i].length > 1 ? '全' : [...sets[i]].sort((a, b) => a - b).join('');
    };
    const same = sets.every(x => x.length > 1 && x.length === sets[0].length && x.every(c => sets[0].includes(c)));
    const text = same && (ordered ? sets[0].length >= size : sets[0].length > size) ? `${[...sets[0]].sort((a, b) => a - b).join('')} BOX` : sets.map((_, i) => word(i)).join(ordered ? '-' : '=');
    out.push({ text, points: best.ex.size, keys: [...best.ex] });
    for (const k of best.ex) rest.delete(k);
  }
  return out.sort((a, b) => b.points - a.points);
}

// 表示用: 「1-23-2345 (6点) / 4-1-5」
export function formationText(keys, type, cars) {
  return toFormations(keys, type, cars).map(f => (f.points > 1 ? `${f.text} (${f.points}点)` : f.text)).join(' / ');
}
