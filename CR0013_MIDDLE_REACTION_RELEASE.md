# KEIRIN FLOW — CR-0013 MIDDLE REACTION

## 修正の核心
YIELD後に隊列を機械的に `789 / 456 / 123` と確定しない。
前を取った789が流した瞬間、中団ライン先頭の脚質を再評価する。

- `runStyle=NIGE` または `SENKO` → `MIDDLE_REACTION`
- 456が789を叩く
- 実座標で `456 / 789 / 123` が成立してから後方123のKAMASIへ
- MAKURI/JIZAIなら中団は無理に叩かず、従来のKAMASI遷移へ

## ブラウザ起動経路
CR-0013のPages確認用 `main.js` は明示的に `scenarioId=YIELD_KAMASI` を渡す。
したがってSTART時に旧TSUPPARI_MAKURIが再生される問題を防止する。

## 教師展開
789誘導切り → 123 YIELD → 789前 → 4(NIGE)が緩みを叩く
→ 456 / 789 / 123 → 123打鐘カマシ → 主導権奪取 → 1-2ワンツー

## 回帰
- CR-0011 TSUPPARI_MAKURI維持
- CR-0012 動的ライン＋SOLO KIRIKAE維持
- CR-0013 3分戦中団再判断を0.5x/1x/2x/3xで検証
