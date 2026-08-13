# Sprint PRD: Preview 主 Tick 隔离修复 — 确认并关闭 P0 issue a9a6e3f6

**Task ID**: 85d959e8-569e-4a17-a98f-229c71e14e6d
**Gear**: hotfix
**Sprint**: sprints/08131452-relay-85d959e8

---

## 背景

PR #4853 在 `scheduler-jobs.js` 加了 `BRAIN_PREVIEW=1` 守卫，防止 Preview Brain 跑定时 job 循环。但主 Tick（`initTickLoop` + `tryRecoverTickLoop`，位于 `packages/brain/src/tick-recovery.js`）**仍无 `BRAIN_PREVIEW` 守卫**。

`preview-env-start.sh` 启动 Preview Brain 时设置：
- `BRAIN_PREVIEW=1`
- `CECELIA_TICK_ENABLED=false`

但克隆自生产的 DB 中 `working_memory.tick_enabled = true`。`initTickLoop` 读 DB 状态，发现 `enabled=true` → 调用 `startTickLoop()` → Preview Brain 启动主 Tick 派发任务，与生产/其他 Preview 实例产生并发双派发。

Issue：`a9a6e3f6-06c7-42a7-840f-09e6ef7f448a`（P0，brain）

## 修复范围

**文件**: `packages/brain/src/tick-recovery.js`

1. **`initTickLoop()`（line ~169）**：在 `BRAIN_DEPLOY_CANARY` 守卫之前，加 `BRAIN_PREVIEW=1` 早返回
2. **`tryRecoverTickLoop()`（line ~90）**：在 `CECELIA_TICK_HARD_OFF` 守卫之后，加 `BRAIN_PREVIEW=1` 早返回

守卫语义与 `scheduler-jobs.js` 保持一致：`=== '1' || === 'true'`。

## Invariant 约束

- I1：Preview Brain（`BRAIN_PREVIEW=1`）绝不启动主 Tick loop（`startTickLoop` 零次调用）
- I2：Preview Brain 的 recovery timer 也绝不拉起 Tick loop
- I3：非 Preview Brain（`BRAIN_PREVIEW` 未设置）的行为完全不变（零回归）
- I4：守卫内聚于 `tick-recovery.js`，不改 `server.js` 调用侧

## 累积 FR

- FR1：`initTickLoop()` 在 `BRAIN_PREVIEW === '1'` 或 `=== 'true'` 时，**在读 DB 之前**返回 `{success:true,enabled:false,loop_running:false,preview:true}`
- FR2：`tryRecoverTickLoop()` 在 `BRAIN_PREVIEW === '1'` 或 `=== 'true'` 时，清除 recoveryTimer 后 return
- FR3：两个函数均在 Preview 模式下打印含 `"BRAIN_PREVIEW"` 字样的日志
- FR4：`BRAIN_PREVIEW` 未设置或为其他值时，现有行为完全不变

## NFR

- 不引入新依赖
- 守卫条件与 `scheduler-jobs.js` 和 `harness-skill-relay.js` 保持一致

## 锚定声明

> hotfix 断言——generator 禁止修改这些断言，违反必须 FATAL 升档

**[ANCHOR-1]** `initTickLoop()` 在 `process.env.BRAIN_PREVIEW === '1'`（或 `'true'`）时，**在任何 DB 查询或 `startTickLoop()` 调用之前**返回，不启动 Tick loop

**[ANCHOR-2]** `tryRecoverTickLoop()` 在 `process.env.BRAIN_PREVIEW === '1'`（或 `'true'`）时，清除 recoveryTimer 后 return，不调用 `startTickLoop()`

**[ANCHOR-3]** 两个函数在 Preview 模式跳过时各打印一条含 `"BRAIN_PREVIEW"` 字样的 `tickLog`/`console.log`

**[ANCHOR-4]** `BRAIN_PREVIEW` 未设置时，`initTickLoop()` 在 DB 中 `tick_enabled=true` 时正常调用 `startTickLoop()`（现有行为零回归）

journey_type: dev
target_environment: local
