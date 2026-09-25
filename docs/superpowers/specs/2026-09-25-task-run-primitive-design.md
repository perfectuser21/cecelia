# runner 原语：一次执行 = 一行 task_runs（链 bf5088a3 棒1，任务 66db3dfb）

需求真身：Harness 三轮对抗产物（PRD + 合同 + 红测试，远端分支 `cp-harness-propose-r3-66db3dfb-rb2145bd9-a84`），本稿只记落地取舍。

## 事实（origin/main e6c1922406 实测）

- `task_runs`（migration 059）在 `packages/brain/src` 零 INSERT/UPDATE；执行留痕散在 task_events / dispatch_events / tasks.result。
- `dispatch_events` 的 `dispatched` 行由 `recordDispatchResult(pool, true)` 写，**当前不传 task_id（恒 NULL）**——裸跑检测的 join 键是空的，必须补传。
- `triggerCeceliaRun` 是所有执行的漏斗：dispatcher、`routes/tasks.js`、`routes/execution.js` 三处调用，内部分派 codex review / staging_e2e / internal handler / openclaw-agent / codex-bridge / minimax / harness kernel / cecelia-bridge。
- cecelia-run.sh 与 cecelia-bridge.cjs 跑在执行机，终态回执本来就带 `run_id`（= checkpoint_id = Brain 生成的 runId）打到 `POST /execution-callback`。

## 设计

### 1. 唯一写口 `lib/task-run.js`

| 导出 | 语义 |
|---|---|
| `startRun({taskId, runId, source, context}, {pool?})` | `INSERT … ON CONFLICT (run_id) DO NOTHING`，一次执行恒一行；fail-open 返回 null |
| `finishRun({runId, status, exitCode, artifacts, error}, {pool?})` | `UPDATE … WHERE run_id AND ended_at IS NULL`，已终态不覆盖；running/未知状态不动 |
| `recordRunFromCallback(...)` | 回执通道用：确保行存在（补 start）+ 终态回执 finish |
| `findBareRuns(pool, {windowMinutes})` | dispatched 事件无对应 run 行（run 可早于事件 5 分钟） |
| `normalizeRunStatus / buildRunContext / buildRunResult / detectBareRuns` | 纯逻辑，合同冻结测试直测 |

状态枚举沿用 059 注释：`running/success/failed/timeout/cancelled`；`completed*` / `succeeded` → success，`failed` / `quota_exhausted` → failed。执行路径存 `context.source`，exit code 与产物引用存 `result.exit_code` / `result.artifacts`。**不改 059 现有列。**

### 2. 接线（五条执行路径）

| 路径 | 接法 |
|---|---|
| executor | `triggerCeceliaRun` 改名 `_triggerCeceliaRunInner`，导出同名薄包装：结果 `success && runId` → `startRun`（source 取 `result.executor`，缺省 `executor`）。覆盖 dispatcher / tasks 路由 / execution 路由三处调用方 |
| dispatcher | 派发成功后 `startRun` 兜底（同 runId 幂等，internal handler 等无 runId 的成功执行补合成 runId 并立即 finish），并把 `nextTask.id` 传进 `recordDispatchResult`，让 dispatched 事件带 task_id |
| openclaw-agent-executor | 起 ssh 后 `startRun`（注入自己的 pool）；收割器 UPDATE 终态后 `finishRun`（exit 与 log 尾巴产物） |
| cecelia-run / cecelia-bridge（执行机脚本） | 不改脚本：Brain 侧 executor 已在触发时 startRun；脚本的终态回执带 `run_id`+`exit_code`，由 execution-callback 走 `recordRunFromCallback` finish。守卫测试钉死「脚本回执 payload 含 run_id / exit_code」这一耦合 |
| bridge（kernel 编排桥） | kernel run 的 runId 经 triggerCeceliaRun 包装 start；终态在 `finalizeKernelRun` 提交后 `finishRun`（fail-open） |

### 3. 单一写口守卫

`task-run-single-writer-guard.test.js`：扫 `packages/brain/src`（不含 `__tests__`、`lib/task-run.js`），对 task_runs 的 `INSERT INTO` / `UPDATE` / `DELETE FROM` 一律红。proven-to-fire：测试内造一个违规临时文件断言扫描器报红。

### 4. 迁移 468

`task_runs` 加 `notion_id / notion_synced_at / notion_digest`（PR B 的投影记账，纯 additive）。PR A 只落迁移与写口，PR B 落 `pushTaskRuns`。

## 已知风险（据实登记）

- `alertness/healing.js` 的 `quarantineProblematicTasks` 读 `task_runs WHERE status='failed'` 三次以上隔离 queued/pending 任务。此前表为空该路径休眠，写口上线后会激活；语义符合「三次失败自动隔离」，但属二阶效应。
- 脚本步（device_job / workflow_run）与晨报、Notion 投影在 PR B。
