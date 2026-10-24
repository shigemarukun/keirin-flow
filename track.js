// KEIRIN FLOW — バンクの形 (400mバンク)
// 画面の描き方 (ui.js) と、エンジンの「外を回ると遠回りになる」計算で同じ形を使う。

export const TRACK = Object.freeze({
  LENGTH: 400,
  FINISH_LINE_PHASE: 50,   // 0m 地点をホームストレッチ中央へずらす量
  HALF_STRAIGHT_PX: 140,   // 画面上の直線の半分 (px)
  RADIUS_PX: 200,          // 画面上のコーナー半径 (px)
  LANE_METERS: 0.02        // 走路位置 (laneOffset) 1 あたりの横方向の距離 (m)
});

const straightPx = 2 * TRACK.HALF_STRAIGHT_PX;
const cornerPx = Math.PI * TRACK.RADIUS_PX;
const totalPx = 2 * straightPx + 2 * cornerPx;
export const STRAIGHT_M = TRACK.LENGTH * straightPx / totalPx;   // 直線1本の長さ (m)
export const CORNER_M = TRACK.LENGTH * cornerPx / totalPx;       // コーナー1つの長さ (m)
export const CORNER_RADIUS_M = CORNER_M / Math.PI;               // コーナーの半径 (m)

// 周長 L のバンク (333 / 400 / 500) でも同じ形を、長さだけ比例させて使う
export const shapeFor = (L = TRACK.LENGTH) => {
  const k = L / TRACK.LENGTH;
  return { length: L, straight: STRAIGHT_M * k, corner: CORNER_M * k, radius: CORNER_RADIUS_M * k, phase: TRACK.FINISH_LINE_PHASE * k };
};

// その地点がコーナーかどうか
export function isOnBend(distance, L = TRACK.LENGTH) {
  const g = shapeFor(L);
  const d = (((distance + g.phase) % L) + L) % L;
  const b1 = g.straight, b2 = b1 + g.corner, b3 = b2 + g.straight;
  return (d >= b1 && d < b2) || d >= b3;
}

// 内側の走路 (laneOffset = innerLane) より外を走ると、コーナーで遠回りになる。
// 返すのは「進んだ距離のうち、内側の走路に換算して進める割合」(直線では 1)。
export function pathFactor(distance, laneOffset, innerLane = -18, L = TRACK.LENGTH) {
  if (!isOnBend(distance, L)) return 1;
  const outside = Math.max(0, laneOffset - innerLane) * (globalThis.KF_TUNE?.lane ?? TRACK.LANE_METERS);
  const R = shapeFor(L).radius;
  return R / (R + outside);
}
