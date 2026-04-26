# PRD: D2.2 — 抽 tick-loop.js (runTickSafe + startTickLoop + stopTickLoop)

## Goal

把 `packages/brain/src/tick.js` L226-L347 的 3 个 loop 控制函数抽到新建的 `tick-loop.js`，
配套搬走 3 个 loop 相关常量（TICK_INTERVAL_MINUTES / TICK_LOOP_INTERVAL_MS / TICK_TIMEOUT_MS），
让 tick.js 行数 < 600，模块边界更清晰。

## Context

D 阶段（tick.js 拆分）接力链：

- D1.7a：tickState 收口到 tick-state.js（已合）
- D1.7b：executeTick body 抽到 tick-runner.js（已合）
- D2.1：9 个 _resetLastXxxTime 测试 helper 收口到 tick-state.js（已合 #2632）
- **D2.2（本 PR）**：runTickSafe / startTickLoop / stopTickLoop 抽到 tick-loop.js
- D2.3（并行）：tryRecoverTickLoop / initTickLoop / enableTick / disableTick 抽到 tick-recovery.js
- D2.4（并行）：getTickStatus / isStale / getStartupErrors 抽到 tick-status.js

D2.2/D2.3/D2.4 都触碰 tick.js 中央 export 块（不同行），冲突风险中等。

## Scope

**新建** `packages/brain/src/tick-loop.js`（167 行）：
- 3 函数：`runTickSafe(source, tickFn?)` / `startTickLoop()` / `stopTickLoop()` — 实现 1:1 复刻，零行为变更
- 3 常量：`TICK_INTERVAL_MINUTES` / `TICK_LOOP_INTERVAL_MS` / `TICK_TIMEOUT_MS` — export
- 本地 `tickLog` helper：与 tick.js / tick-runner.js 同形态（独立计数器，不污染主进程 summary）
- imports：`tickState` (./tick-state.js)、`executeTick` (./tick-runner.js)、`publishCognitiveState` (./events/taskEvents.js)

**改** `packages/brain/src/tick.js`：
- 删 L226-L347 三函数定义（114 行）
- 删 L73-L76 三常量定义
- 删 publishCognitiveState import（只在 startTickLoop 用）
- 加 `import { runTickSafe, startTickLoop, stopTickLoop, TICK_INTERVAL_MINUTES, TICK_LOOP_INTERVAL_MS, TICK_TIMEOUT_MS } from './tick-loop.js'`
- 中央 export 块照常 re-export 这 6 个 symbol，老 caller 不受影响

## 关键设计

- **零行为变更**：函数体一字不改，复刻搬迁
- **executeTick 注入语义保持**：runTickSafe(source, tickFn?) 默认用 tick-runner 的 executeTick，测试可注入 mock
- **tickLog 各模块独立计数器**：tick.js / tick-runner.js / tick-loop.js 各有一份本地 tickLog，[tick-summary] 标签独立（避免共享单例的复杂性）
- **3 个常量随函数走**：TICK_INTERVAL_MINUTES / TICK_LOOP_INTERVAL_MS 仍被 tick.js 的 getTickStatus 用 → 通过 import 回来用
- **不动其他区段**：tryRecoverTickLoop / initTickLoop / getTickStatus / enableTick / disableTick 留给 D2.3/D2.4

## 接力链协调

- D2.3（d2-builder-3）：tick-recovery.js 将 import { startTickLoop } from './tick-loop.js'（直接引用本 PR 新建的模块）
- D2.4（d2-builder-4）：tick-status.js 将 import { TICK_INTERVAL_MINUTES, TICK_LOOP_INTERVAL_MS } from './tick-loop.js'
- 谁先 push 触发 CI 谁直接合；后合者解 trivial conflict（中央 export 块行差异）

## 成功标准

1. 新建 `packages/brain/src/tick-loop.js` 包含 3 函数 + 3 常量
2. tick.js 行数 < 600（实际 589）
3. 老 caller `import { runTickSafe } from './tick.js'` 仍可用（backwards-compat 由 tick.js 中央 export 块保持）
4. 全部 tick-* 单测 100% pass
5. node --check tick.js / tick-loop.js 通过

详见 `DoD.cp-0426093610-d22-tick-loop.md`。
