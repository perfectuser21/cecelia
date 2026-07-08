# 健康看板僵尸指标修复 + 取消 janitor docker-prune — 设计

## 问题（三个独立僵尸，同根因 Wave-2 迁移断链）
1. `tick_execution_stats` / `tick_last` / `tick_actions_today` 三个 working_memory key 冻在 2026-05-05：写入方在 Wave-2 废弃的 `executeTick()`（tick-runner.js）体内，活路径 `runScheduler()` 从不写 → /health 的 tick_stats 呈"死机两个月"假象。
2. capability-probe 自 05-22 死透：`startProbeLoop()`（自带 1h setInterval + 30s 首跑）全仓零调用方。
3. janitor docker-prune：旧机制，用户拍板取消；且 `docker container prune -f` 有部署自杀竞态（Issue 97cf5a41）。

## 修法
### A. tick 统计接回活路径
- 新模块 `packages/brain/src/tick-stats.js`：从 tick-runner 抽出等价逻辑（不改 tick-runner，保留回滚）——
  - `recordTickExecution(durationMs, deps?)`：事务 + FOR UPDATE UPSERT `tick_execution_stats`（total_executions++ / last_executed_at 上海时区 sv-SE 格式 / last_duration_ms），同事务外 UPSERT `tick_last` `{timestamp: ISO}`。
  - `incrementActionsToday(count?, deps?)`：同日累加、跨日重置（照 tick-runner L219 语义）。
  - 两者失败只 console.warn，绝不抛出。deps.pool 可注入（测试）。
- `tick-loop.js` `runTickSafe`：doTick 成功后 fire-and-forget 调 `recordTickExecution(耗时)`；skipped/异常路径不调。
- `dispatcher.js`：成功派发点（`dispatched: true` 的真派发返回处）fire-and-forget 调 `incrementActionsToday(1)`。

### B. probe 复活
`tick-loop.js` `startTickLoop()`：与 startHarnessWatchdogLoop/startRecoveryLoop/startPipelinePatrolLoop 并排调用 `startProbeLoop()`（模块自带幂等 guard `_probeTimer`）。不接 scheduler-jobs（probe 自带完整循环，与其他兄弟 loop 同模式）。

### C. janitor docker-prune 取消
- `janitor.js`：REGISTRY 移除 dockerPrune、删 import（REGISTRY 留空数组，框架保留）。
- 删除 `janitor-jobs/docker-prune.js` + `__tests__/docker-prune.test.js`。
- `__tests__/janitor.test.js` 同步：getJobs 返回空 jobs、runJob('docker-prune') 抛 Unknown。
- 效果：API `POST /janitor/jobs/docker-prune/run` → 404，Dashboard 列表为空。

## 不做的事
- 不改 tick-runner.js（废弃件保留回滚用）
- 不修 runJob 不查 enabled 的 bug（job 已清空，无意义）
- 不动 CURRENT_STATE.md 静态文档（另一层问题）

## 验收（部署后真环境）
- working_memory 三 key updated_at 变为当天；/health tick_stats.last_executed_at 不再是 2026-05-05
- docker logs 出现 `[Probe] Starting capability probe loop`
- GET /api/brain/janitor/jobs 的 jobs 为空数组

## 版本
brain 1.243.2 → 1.243.3，四处同步。
