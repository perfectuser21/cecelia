# PRD: Brain v2 D2.1 — 9 个 _resetLastXxxTime 测试 helper 移到 tick-state.js

## 背景

Phase D1.7a（已合）把 `tick.js` 14 个 `_lastXxxTime` 节流字段 + 5 个 loop 控制态收口到 `tick-state.js`。但当时遗留了 9 个 trivial test helper 函数（每个 1 行 `tickState.lastXxxTime = 0`）仍住在 `tick.js` L602-L617，形成"状态在 A、单字段 reset 在 B"的不对称。

D2.2/D2.3/D2.4 接下来要把 tick.js 的 loop / recovery / status 区段抽成独立子模块。如果 9 个 reset helper 还留在 tick.js，新模块要 reset 单个节流字段就得反向 import tick.js，破坏分层。

## 目标

把以下 9 个函数从 `packages/brain/src/tick.js` 搬到 `packages/brain/src/tick-state.js`，**零行为变更、零调用方修改**：

- `_resetLastExecuteTime` / `_resetLastCleanupTime` / `_resetLastZombieCleanupTime`
- `_resetLastHealthCheckTime` / `_resetLastKrProgressSyncTime`
- `_resetLastHeartbeatTime` / `_resetLastGoalEvalTime`
- `_resetLastZombieSweepTime` / `_resetLastPipelinePatrolTime`

## 设计决策

### 1. tick-state.js 直接 export，不走 factory

延续 D1.7a 风格 — `tickState` 是单例对象，9 个 reset 是单例的薄方法层。函数体保持 1 行，不引入额外抽象。

### 2. tick.js 保留 backwards-compat re-export

测试代码（5 个文件）当前 `import { _resetLastXxxTime } from '../tick.js'`。本 PR **不改测试 import 路径**，tick.js 末尾追加：

```js
export {
  _resetLastExecuteTime, ... 9 helpers
} from './tick-state.js';
```

这样 D2.2/3/4 后续 PR 可以让新模块 import from './tick-state.js'（正向依赖），同时旧测试零修改。

### 3. 不动 `resetTickStateForTests`

D1.7a 已有的 `resetTickStateForTests()` 仍然是"全清"语义（19 个字段一次归零），用于 beforeEach 完整隔离。9 个单字段 reset 是细粒度版本，并存不冲突。

## Scope

- ✅ `packages/brain/src/tick-state.js`：新增 9 个 `export function _resetLastXxxTime` + default export 列出
- ✅ `packages/brain/src/tick.js`：删 L602-L617（9 个 `function` 定义） + 从中央 `export {}` 块剔除 9 个名字 + 末尾追加 `export { ... } from './tick-state.js'` re-export
- ❌ 不动 `tickState` / `resetTickStateForTests` 现有签名
- ❌ 不动任何测试 import 路径（5 个测试文件继续 from '../tick.js'）
- ❌ 不动 tick-loop / tick-recovery / tick-status 区段（D2.2/3/4 才动）

## 成功标准

- 所有 5 个 DoD `manual:` 命令 exit 0（见 DoD.cp-0426090535-d21-reset-helpers.md）
- `tick-cleanup.test.js` / `tick-throttle.test.js` / `heartbeat-tick.test.js` / `tick-layer2-health.test.js` / `tick-goal-eval-integration.test.js` 5 套测试 pass（confirmed local 11/11 pass）
- CI L1/L2/L3/L4 全绿
- 不引入新 lint 警告，不动 server.js / 其它模块

## 接力链

- 前置：D1.7a（tickState 收口，已合），D1.7c plugin1/plugin2（已合 #2627/#2626）
- 本 PR：D2.1（reset helper 收口）
- 后续 blocked by 本 PR：D2.2 / D2.3 / D2.4（builder-2/3/4 接力 tick.js loop/recovery/status 抽模块）
