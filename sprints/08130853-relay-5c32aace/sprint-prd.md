# Sprint PRD: Preview Brain scheduler-jobs 幂等保护

**Task ID**: 5c32aace-4114-426c-b9dd-765f1c4d5bb2
**Gear**: hotfix
**Sprint**: sprints/08130853-relay-5c32aace

---

## 背景

Preview Brain（`BRAIN_PREVIEW=1`）是为每个 PR 启动的隔离快照 Brain 实例（端口 5300-5399）。
`preview-env-start.sh` 设置 `CECELIA_TICK_ENABLED=false` 禁了 tick loop，但 `server.js` 在
`startSchedulerJobsLoop(pool)` 和 `startProjectionJobsLoop(pool)` 的调用处没有 `BRAIN_PREVIEW` 守卫——
Preview Brain 照样启动 60s 轮询调度循环。

**影响**：scheduler-jobs 里的 handler（如 `capture-triage`、`notion-capture-ingest`、
`projection-command-apply` 等）在预览库快照上运行，会创建 harness_initiative 任务、写入
working_memory 哨兵、向外部系统推数据，造成：
1. **并发重复派发**：每 60s 触发一次，捕获-分诊等 handler 对快照中的 pending 条目重复下单
2. **预览环境数据污染**：projection outbox 写数据到 Notion/外部系统，与生产混淆
3. **harness 拒绝闸无法覆盖全链路**：spawn 守卫在 `harness-skill-relay.js` 已有，但上游 job
   创建 task 记录本身就不该发生在预览 Brain 里

## 修复范围

**文件**: `packages/brain/src/scheduler-jobs.js`

在 `startSchedulerJobsLoop` 和 `startProjectionJobsLoop` 的入口处加 `BRAIN_PREVIEW` 守卫：
当 `process.env.BRAIN_PREVIEW === '1'` 或 `=== 'true'` 时，直接返回 `null`，不启动 loop。

## Invariant 约束

- I1：Preview Brain（`BRAIN_PREVIEW=1`）不应运行任何 scheduler job 循环
- I2：非 Preview Brain 的启动行为不受任何影响（零回归）
- I3：修改只在 `scheduler-jobs.js` 内部——不改 `server.js` 调用侧（守卫内聚）

## 累积 FR

- FR1：`startSchedulerJobsLoop` 在 `BRAIN_PREVIEW=1` 时返回 `null`，不调用 `setInterval`
- FR2：`startProjectionJobsLoop` 在 `BRAIN_PREVIEW=1` 时返回 `null`，不调用 `setInterval`
- FR3：两个函数均在 Preview 模式下打印一条 `[scheduler-jobs] BRAIN_PREVIEW` 日志
- FR4：`BRAIN_PREVIEW` 未设置或为其他值时，现有行为完全不变（幂等性、重入守卫均保留）

## NFR

- 不引入新依赖
- 守卫条件与 `harness-skill-relay.js:338` 保持一致（同样检查 `'1'` 和 `'true'`）

## 锚定声明

> hotfix 断言——generator 禁止修改这些断言，违反必须 FATAL 升档

**[ANCHOR-1]** `startSchedulerJobsLoop(pool)` 在 `BRAIN_PREVIEW=1` 时返回 `null` 且 `setInterval` 零次调用（幂等跳过，防并发重复派发）

**[ANCHOR-2]** `startProjectionJobsLoop(pool)` 在 `BRAIN_PREVIEW=1` 时返回 `null` 且 `setInterval` 零次调用

**[ANCHOR-3]** `BRAIN_PREVIEW` 未设置时，`startSchedulerJobsLoop` 正常返回 timer 对象，前进 60s 触发 handler（现有行为零回归）

**[ANCHOR-4]** `BRAIN_PREVIEW=1` 时两个函数各打印一条含 `"BRAIN_PREVIEW"` 字样的 console 日志

journey_type: dev
target_environment: local
