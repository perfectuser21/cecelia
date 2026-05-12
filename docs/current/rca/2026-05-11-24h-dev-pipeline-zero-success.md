# 2026-05-11 RCA — Dev Pipeline 24h 0% 成功率

## TL;DR
最近 24h 完成 0、失败 14（其中 12 条由 zombie-reaper 在 30min idle 后兜底标 failed）。
所有 dev 类失败任务由唯一 dispatcher `brain-tick-7` claim 后再无人回写 `tasks.status`，
不是 spawn 自己挂——挂的是 dev-task graph 完成后无人把结果送进 callback 链路。
zombie-reaper（commit 9ab3684d8）已上线，是清扫层；本 RCA 闭合根因层。

## 失败模式分布（24h，N=26）

| 错误模式 | 数量 | 含义 |
|---|---|---|
| `[reaper] zombie: in_progress idle >30min` | 12 | 任务被 claim 后 updated_at 30min 不更新，zombie-reaper 兜底标 failed |
| `[ops ...zombie in_progress (updated_at frozen 6h+...)]` | 8 | 同上但 zombie-reaper 上线前/外的手工 ops 清理 |
| `manual_evict_for_W27/W28` | 2 | 高优 harness 任务挤位手工 evict 当前 in_progress 占位 |
| `[ops cleanup ...stale queued >24h...]` | 1 | queued 队首阻塞被 ops 手工跳过 |
| `Docker exit=125: Conflict. The container name "...is already in use"` | 1 | 容器名冲突（W27 harness initiative attempts=2/3） |
| `final_e2e_verdict=FAIL: Step 3 — happy + schema 完整性` | 1 | 真业务验证 FAIL（这条是合理失败） |
| `NULL` | 1 | 主动取消，无错误 |

- `task_type` 100% `dev`；`delivery_type` 100% `code-only`；`location` 100% `us`；`claimed_by` 100% `brain-tick-7`。
- 同期 `completed_at` 落在 24h 窗的任务：**0 条**。
- 当前仍 in_progress 5 条，updated_at 全部早于 started_at —— 与上述模式一致（claim 后无回写）。
- 同期 harness pipeline（W25-W29 系列）正常出 PR：harness-task / harness-initiative 走另一条 graph 路径（spawnDockerDetached + LangGraph interrupt/Command resume），不在本故障域。

## Top 3 根因（按影响排序）

### RC1 — dev-task graph 缺 tasks.status 回写（本次修复目标）

**症状**：dispatcher 通过 `_dispatchViaWorkflowRuntime` 把 dev 任务路由到 `dev-task.graph.js`，
graph 唯一节点 `runAgentNode` 跑完 `spawn()` 后只把结果塞回 LangGraph state，**没人把 `tasks.status` 标 completed/failed**。
任务在 DB 永卡 `in_progress`，updated_at 不变。

**证据**：
- `packages/brain/src/workflows/dev-task.graph.js:36-57` — 节点 `return { result }` / `{ error }` 后直接 END，不触发 callback_queue。
- 对照：legacy `executor.js:3257` 走 `triggerCeceliaRun` 路径会调 `writeDockerCallback` 入队，由 `callback-worker → callback-processor` 标 status。
- 对照：`harness-initiative.graph.js` 同类 hole 在 PR #2903（commit 197dc7b05）已修 —— `reportNode` 显式 `UPDATE tasks SET status=...`。dev-task 还没修。
- 24h 内 12 条 `[reaper] zombie` 全部 task_type=dev、走的就是这条 graph。

**修复**（本 PR）：
`runAgentNode` 在 spawn 返回/throw 后调 `writeDockerCallback(task, runId, null, result)`：
- spawn 成功 → 透传真 result；
- spawn throw → 合成 `result={exit_code:1, stderr:err.message, ...}` 入队；
- writeDockerCallback 自身抛 → warn 不阻断，zombie-reaper 兜底（不放大故障半径）。

**优先级**：**P0**。这条不修，dev pipeline 永远 0%；harness 在跑只是因为它走另一条 graph。

---

### RC2 — dispatcher fire-and-forget catch 仅 log 不补偿

**症状**：`dispatcher.js:588`
```js
runWorkflow('dev-task', taskId, attemptN, { task: taskToDispatch })
  .catch(err => logTickDecision(...));   // 只记日志
```
spawn 触发链路任意一处异常（docker daemon 不可达 / preparePrompt 抛 / pg-checkpointer get 失败）都让 graph 半路死掉。
**catch 不会**：
1. 释放 claim（`claimed_by` 保持 brain-tick-7）；
2. 把 status 回滚到 queued；
3. 触发 retry。

结合 RC1，所有失败路径终点都是「永远 in_progress」。

**证据**：
- `packages/brain/src/dispatcher.js:587-602` — `.catch` 内只调 `logTickDecision`。
- legacy 路径 `dispatcher.js:482-501` 对 `triggerCeceliaRun` 失败有 `updateTask({ status: 'queued' })` + `claimed_by=NULL` 回滚；v2 workflow 路径漏了这套。

**建议修复**（独立 PR）：
- `.catch` 内补一段：`UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL, started_at=NULL WHERE id=$1 AND status='in_progress'`；
- 或者：catch 内直接调 `writeDockerCallback` 合成 failure 入队（与本 PR 同链路），让 callback-processor 走标准 retry/quarantine。

**优先级**：**P1**。修了 RC1 之后还需要 RC2 兜住 spawn 之前的失败路径（preparePrompt / pg-checkpointer / cost-cap throw 等）。

---

### RC3 — docker container 名 task_id 1:1 映射，残留时重试 Conflict

**症状**：
```js
function containerName(taskId) {
  const short = String(taskId).replace(/-/g, '').slice(0, 12);
  return `cecelia-task-${short}`;
}
```
（`docker-executor.js:127-130`）

`docker run --name X --rm` 在前一次 attempt 容器还没被 daemon 真删时，下一次 attempt 用同名 → `Conflict. The container name "..." is already in use` → `exit=125` → spawn `attemptLoop` 三次连续 Conflict → 整条 spawn fail。
Race 出现在 `--rm` 异步清理还没完成但下一轮 attempt 已经发出。

**证据**：
- 24h 1 条命中（W27 harness GET /decrement，attempts=2/3）。
- 旧 RCA `docs/current/rca/2026-04-25-24h-business-failures.md` 已记录同类。
- attempt loop 没在重试前先 `docker rm -f $name` 兜底。

**建议修复**（独立 PR）：
- option A（轻）：`executeInDocker` 入口先 `docker rm -f ${name} 2>/dev/null || true` 兜一道；
- option B（重）：container 名加 attempt 后缀 `cecelia-task-${short}-a${attemptN}`，天然避开冲突。

**优先级**：**P2**。24h 仅 1 条命中，但若在容器密集发生时会放大。

---

## 修复路线

| 序号 | 内容 | 优先级 | 状态 |
|---|---|---|---|
| RC1 | dev-task runAgentNode 回写 callback_queue | P0 | **本 PR 交付，TDD 5 红→12 绿** |
| RC2 | dispatcher v2 catch 补偿（释放 claim / 入队 failure） | P1 | 待启动 |
| RC3 | docker container 名冲突防护（pre-rm 或 attempt 后缀） | P2 | 待启动 |

## 验证
- `vitest run src/workflows/__tests__/dev-task.graph.test.js` — 12/12 pass（含 5 个新增 callback writeback case）
- `vitest run src/workflows/` — 200 pass / 3 skip / 0 fail（无回归）
- 上线后预期：dev task 不再出现 `[reaper] zombie` 标记，`completed_at` 在合理 spawn 时窗内填上
