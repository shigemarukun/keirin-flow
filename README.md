# KEIRIN FLOW — CR-0012

Phase-Driven Scenario Engine の汎用化版。

`RaceSetupConfig.scenarioId` と任意長の `lines` を `PhysicsEngine` に渡すだけでシナリオを切り替えられます。

```js
{
  scenarioId: 'YIELD_KAMASI',
  lines: [
    { id:'LINE_A', members:[1,2,3], leader:1 },
    { id:'LINE_B', members:[4,5], leader:4 },
    { id:'SOLO_6', members:[6], leader:6 },
    { id:'LINE_C', members:[7,8,9], leader:7 }
  ],
  riders: { 6:{ solo:true } }
}
```

1車ラインは自動的に `ROLE.SOLO`。攻防局面では `KIRIKAE` により、速度・位置・ライン整合度から最も有望な別ラインの最後尾へ切り替えます。

## Scenario blocks
- START: `TSUPPARI` / `YIELD`
- MIDDLE: `SECOND_ATTACK` / `KAMASI` / `PACE_HOLD`
- FINISH: `MAKURI` / `NIGERIKIRI`

## Checks
```bash
npm run check
```
