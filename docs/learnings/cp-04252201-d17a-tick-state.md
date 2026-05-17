# Learning: Brain v2 Phase D1.7a — tick-state.js 抽出

Branch: `cp-0425220128-d17a-tick-state`
Task: brain-v2-d-team Task #1
Date: 2026-04-25

## 背景

`packages/brain/src/tick.js` 已经膨胀到 2400+ 行，模块级散落 19 个 in-memory 状态变量（14 个 `_lastXxxTime` 节流计时器 + `_loopTimer` / `_recoveryTimer` / `_tickRunning` / `_tickLockTime` / `_lastConsciousnessReload`）。D1.7b/D1.7c 即将抽 executeTick 与 plugin，需要先有一个共享、可测的状态容器，否则后续要在 4-5 个文件之间到处传 ref。

## 根本原因

历史上 tick.js 是 brain-v1 一锅炖出来的，新增的 throttle 计时器都直接 `let _lastXxxTime = 0` 加在文件顶部。无对象语义、无单元测试、无 reset 入口（只能通过 `_resetLastXxxTime` 多个 setter 暴露给测试）。这是单文件膨胀 + 全局 in-memory 状态的典型反模式。

## 解决方案

抽出 `packages/brain/src/tick-state.js`：
- `export const tickState`：单例对象，含 14 个 `lastXxxTime` 数值字段 + 5 个 loop 控制态字段
- `export function resetTickStateForTests()`：一行调用清零所有字段
- `tick.js` 保留旧的 `_resetLastXxxTime` 函数（backwards-compat），但内部转为 `tickState.lastXxxTime = 0`

替换策略：用 Python 正则 `(?<![A-Za-z0-9_])_lastXxxTime(?![A-Za-z0-9_])` 做 word-boundary 替换，避免误伤 `_resetLastXxxTime` 这类前缀派生符号。

## 下次预防

- [ ] 凡是新增 module-level `let _lastXxx = 0` 模式，立即在审查阶段拒绝，要求收口到对应的 state 文件
- [ ] 任何 D 阶段的 plugin/runner 抽出，先确认 state 容器已经分离；否则会把 5+ 个文件互相耦合
- [ ] 替换大批量 identifier 时统一用 word-boundary 正则（`(?<!\w)X(?!\w)`），不能用裸字符串 sed

## 影响范围

- `packages/brain/src/tick.js`：删除 19 个 `let _xxx` 声明，~50 处引用替换为 `tickState.xxx`
- `packages/brain/src/tick-state.js`：新文件，~70 行
- `packages/brain/src/__tests__/tick-state.test.js`：新单元测试，6 个 case
- `tests/tick-state.test.js`：DoD 映射用的符号链接

## 验证

5/5 DoD manual 检查通过；`tick-cleanup` / `tick-throttle` / `heartbeat-tick` / `tick-layer2-health` / `tick-state` 共 34 个 vitest 测试全 pass；`node --check tick.js` + `tick-state.js` 双 OK。`tick-goal-eval-integration.test.js` 的 3 个失败为 main 分支预先存在（planner.js mock 不全），与本 PR 无关。
