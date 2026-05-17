## D2.1 — 9 个 _resetLastXxxTime 测试 helper 移到 tick-state.js（2026-04-26）

### 根本原因

tick.js 长期承载 14 个节流字段、9 个 trivial test reset helper、loop 控制态、recovery、status 接口，单文件 700+ 行难以维护。Phase D1.7a 已经把 `tickState` 收口到 `tick-state.js`，但 9 个 `_resetLastXxxTime` 函数还留在 tick.js（每个 1 行 `tickState.lastXxxTime = 0`），形成"状态在 A、reset 在 B"的不对称：

- 测试要重置某个节流字段，要么 import 单字段 reset（来自 tick.js），要么调 `resetTickStateForTests`（来自 tick-state.js，副作用全清），归属混乱。
- D2.2/3/4 接下来要拆 loop / recovery / status 子模块，必须先把测试 helper 沉到 state 层，否则 loop 模块还会反向依赖 tick.js 拿 reset。

### 下次预防

- [ ] 任何"读写同一份模块级 state"的 helper（哪怕 1 行）应该和 state 同文件，避免反向依赖。
- [ ] tick.js 仍保留 `export { ... } from './tick-state.js'` 作为 backwards-compat re-export，测试 import 路径不变（`from '../tick.js'`）。下次想真删 re-export 之前必须先 grep 全 repo 确认无 caller 直接走 tick.js。
- [ ] 拆模块前先做"零行为变更"的状态收口（D1.7a → D2.1），降低后续 D2.2/3/4 的 blast radius。
