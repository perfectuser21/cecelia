# PRD: Brain v2 D1.7c-plugin2 — 4 个 scheduled job 拆 plugin

## 背景

D1.7b（PR #2625 已合）把 `executeTick` 从 `tick.js` 搬到 `tick-runner.js`（1843 行），但 30+ scheduled job 调用仍 inline 在 `executeTick` 函数体内。D1.7c 系列把这些 job 拆成独立 plugin，每个 plugin 自带节流门 + 失败处理 + 日志。

本 PR 是 D1.7c 第二批（plugin2），与 builder-3 的 D1.7c-plugin1 并行：

- plugin1（builder-3）：dept-heartbeat / kr-progress-sync / heartbeat / goal-eval
- plugin2（**本 PR**）：pipeline-patrol / pipeline-watchdog / kr-health-daily / cleanup-worker

## 目标

把 `tick-runner.js` 中 4 个 inline 段落（约 60 行）抽到 4 个独立 plugin 文件：

| Plugin | 节流门 | 调用现有模块 | tick-runner 调用语义 |
|---|---|---|---|
| `pipeline-patrol-plugin.js` | 5 min | `pipeline-patrol.js`（624 行，保留） | fire-and-forget |
| `pipeline-watchdog-plugin.js` | 30 min + MINIMAL_MODE 跳过 | `pipeline-watchdog.js`（166 行，保留） | fire-and-forget |
| `kr-health-daily-plugin.js` | 24h | dynamic `kr-verifier.js` | await（push actionsTaken） |
| `cleanup-worker-plugin.js` | 10 min + MINIMAL_MODE 跳过 | dynamic `cleanup-worker.js`（60 行，保留） | fire-and-forget |

## 设计决策

### 1. 旧 cleanup-worker.js 保留复用

`packages/brain/src/cleanup-worker.js` 已存在（60 行）：它只是 `cleanup-merged-worktrees.sh` 的薄壳（exec wrapper），不含节流逻辑。新 plugin `cleanup-worker-plugin.js` 通过 dynamic import 复用它。

新增的 `cleanup-worker-plugin.js` 负责：
- 节流门（CLEANUP_WORKER_INTERVAL_MS = 10min）
- MINIMAL_MODE 跳过
- tickState.lastCleanupWorkerTime 更新
- stdout 解析 + tickLog
- 错误兜底

### 2. 统一 plugin 契约（与 builder-3 plugin1 兼容）

```js
export async function tick({
  pool,           // 可选（kr-health/cleanup-worker 不用）
  tickState,      // 必需
  tickLog,        // 可选
  MINIMAL_MODE,   // 可选
  intervalMs,     // 测试可覆盖
  ...injectables, // 测试用 loadHealth/loadWorker 替代 dynamic import
}) {
  // 节流门 + MINIMAL_MODE 检查 → 命中返回 { skipped: true, reason }
  // 否则更新 tickState.lastXxxTime + 执行业务
  // 失败兜底返回 { error }
}
export default { tick };
```

### 3. tick-runner.js wire 命名

按 DoD 强约束（grep 检查命名）：
- `pipelinePatrolPlugin` / `pipelineWatchdogPlugin` / `krHealthDailyPlugin` / `cleanupWorkerPlugin`
- 用 `import * as ...` namespace import

### 4. 三个 INTERVAL_MS 常量从 tick-runner.js 移除

`PIPELINE_PATROL_INTERVAL_MS` / `PIPELINE_WATCHDOG_INTERVAL_MS` / `CLEANUP_WORKER_INTERVAL_MS` 已收口到对应 plugin，tick-runner.js 不再读，删除可消除"修改一次要改两处"的同步漂移风险。

## 成功标准

- [x] `pipeline-patrol-plugin.js` / `pipeline-watchdog-plugin.js` / `kr-health-daily-plugin.js` / `cleanup-worker-plugin.js` 4 文件存在并各 export `tick`
- [x] `tick-runner.js` 4 处 wire 调用，命名 `pipelinePatrolPlugin` / `pipelineWatchdogPlugin` / `krHealthDailyPlugin` / `cleanupWorkerPlugin`
- [x] 4 个 plugin 单测全 pass（节流门 + 业务调用 + 错误兜底 + tickLog 行为）
- [x] 既有 `pipeline-patrol.test.js` / `pipeline-watchdog.test.js` / `cleanup-worker.test.js` / `tick-state.test.js` 不破坏
- [x] 旧的 `pipeline-patrol.js` / `pipeline-watchdog.js` / `cleanup-worker.js` 不动
