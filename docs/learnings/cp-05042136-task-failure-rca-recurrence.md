# RCA — 任务成功率 14/40（35%）的根因（cp-05042136 复现窗口）

- 事件日期：2026-05-04
- 影响面：Brain 任务调度 — 5/3 21:36 后批次 dev 任务再次大规模 quarantine
- 严重度：P0（**前置 RCA cp-05040101 已诊断同一 bug，修复至今未合入**）
- 数据窗口：2026-05-03 21:36 → 2026-05-04 21:36（最近 24h）

---

## TL;DR

**这不是新故障，是 cp-05040101（5/4 凌晨）已经诊断完的同一个 bug 第二次复现**。

| 项 | 状态 |
|---|---|
| 根因 | `tick-helpers.js:120` elapsed 算法 bug（`payload.run_triggered_at` 不被重置） |
| 加剧因素 | v2 workflow runtime 派发路径**完全不写** `run_triggered_at`，elapsed 用历史残留值 |
| 前置 RCA | `docs/learnings/cp-05040101-task-failure-rca-24h.md` 已给出 P0 修复方案 |
| 修复进度 | **未提交、未 PR、未合**（git log/branch 全空，无任何尝试） |
| 24h 主分支 26 commits | 几乎全在 stop-hook/engine 改造，Brain 端只有 #2741/#2743/#2748/#2750/#2751，**全部绕开此 bug** |

---

## 1. 直接回答 PRD 4 个调研点

### (1) 10 个失败任务样本
Brain 服务 `localhost:5221` 离线（connection refused），无法实时拉。前置 RCA 在 5/4 同窗口已抽 16 quarantined：全部 `quarantine_info.last_error.type=timeout`、`elapsed_minutes=781-784`、`previous_status=in_progress`、`failure_count=3`，特征指纹完全一致。本次 26 失败大概率沿用同指纹（待 Brain 起来后逐条核对，但代码核查证据已充分）。

### (2) 任务拆分粒度过细 → 级联失败？
**否**。dev 任务正常 30-60min 完成，前置 RCA 已排除粒度因素。被 quarantined 的任务标题集中在"修复自身基础设施"（Wave1-A tick-runner / Circuit Breaker / Auto-Fix probe / revert-to-queued），它们因为现有 bug 跑不动而非粒度过细。

### (3) loop 引擎资源瓶颈
**没有新瓶颈**。本日已合三个去阻塞修复：
- #2750 tick loop 去阻塞 — LLM fire-and-forget + thalamus 30s timeout
- #2751 Circuit Breaker PostgreSQL 持久化（重启自动恢复）
- #2741 self_drive_health in-memory grace（DB 写失败时回退）

OOM/并发超限/资源竞争在 24h commits 中无任何修复痕迹，也无相关 learning。瓶颈不是真因。

### (4) self_drive_health probe 失败是副症状？
**是**。已由 #2741 (5/3) 修复（in-memory `_loopStartedAt` + 6h grace）。该 probe 在 cp-05030003 之前的"自愈循环"里把 PROBE_FAIL_SELF_DRIVE_HEALTH/PROBE_FAIL_RUMINATION 任务塞进队列；这些任务本身就是 16 quarantined 中的几个，自愈系统撞上它要修的那个 bug。修了 probe 不能解 elapsed bug，**根因仍在 tick-helpers.js**。

---

## 2. 代码核查（5/4 21:36 当前 main）

### 2.1 `tick-helpers.js:117-181` — 完全没动

```js
// L120 — 优先级未变
const triggeredAt = task.payload?.run_triggered_at || task.started_at;
// L153-156 — requeue 仍只清 started_at，不清 payload.run_triggered_at
await pool.query(
  `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
   started_at = NULL, updated_at = NOW() WHERE id = $1`,
  [task.id]
);
```

`git log -- packages/brain/src/tick-helpers.js` 最近一次修改 commit `c51e4182a`（4/26 之前），**前置 RCA 后无任何改动**。

### 2.2 v2 workflow runtime 加剧 bug

`dispatcher.js:469` — dev 任务全部走 `_dispatchViaWorkflowRuntime` → `runWorkflow('dev-task', ...)`。该路径**不调用** `updateTaskRunInfo()`，所以 `payload.run_triggered_at` 在 v2 派发时**永远不被刷新**。

只有 v1 残留路径 `triggerCeceliaRun` (`executor.js:2968`) 才走 `updateTaskRunInfo` 重置 `run_triggered_at = NOW()`。dev 任务全部由 v2 接管后，该字段一旦被任何路径设置过，就成了"远古值"。

`grep run_triggered_at packages/brain/src/orchestrator/` → **零命中**。v2 整条 graph-runtime + workflow-registry + pg-checkpointer 都不维护此字段。

### 2.3 elapsed 算法被 3 处共用同一 bug

| 位置 | 用途 | 同 bug |
|---|---|---|
| `tick-helpers.js:120` | autoFailTimedOutTasks 60min 超时检测 | ✓ |
| `executor.js:3311` | liveness probe 60s grace 期 | ✓ |
| `executor.js:3347` | decomp/initiative liveness 60min grace | ✓ |

三处都用 `task.payload?.run_triggered_at || task.started_at`，被同一残留值毒化。

---

## 3. 24h 主分支提交清单（5/4）

```
89f877d7a feat(cortex): RCA prompt 加 Step1 先查跨任务失败模式 (cp-05042136) ← 当前任务
6967dfda2 docs: wave2 tick-scheduler-consciousness learning
51ce34bdd docs: Wave 2 实现计划
f2670c875 [CONFIG] fix(engine): stop-dev.sh done schema 修正
fc8d89460 docs(learning): PreToolUse 拦截行为 bug 终结
ff9995610 [CONFIG] feat(engine): PreToolUse 拦截 (Stop Hook 8 段)
f2300decf docs(learning): pipefail 崩溃+stdout污染
257b2eb50 [CONFIG] test(engine): Ralph 模式 50 case
e1130d1be fix(engine): cleanup.sh grep || true
ee1a1c084 docs(learning): Stop Hook Ralph 模式
5cd732843 docs(spec): Stop Hook Ralph
addc060e5 docs: SYSTEM_MAP v1.1.0
7de4ce81b feat(brain): brain_guidance 基础设施
2f57d8ed3 feat(brain): Circuit Breaker PG 持久化
2285ceba9 fix(brain): tick loop 去阻塞 LLM fire-and-forget
0c5561ef8 [CONFIG] feat(engine): Stop Hook Ralph Loop
bc290a19f [CONFIG] fix(engine): condition 5 严格守门
56e778789 [CONFIG] feat(engine): Stop Hook v20.1.0 严格三态
194bf334a [CONFIG] fix(engine): classify_session fail-closed
c1f1e65ed [CONFIG] refactor(engine): Stop Hook 单一 exit 0
6f92bd550 fix(brain): migration 259 冲突
9ca4e12bc fix(brain): self_drive_health in-memory grace
a96138784 fix(ci): CI gate harness-contract-lint
```

**26 提交里 0 个针对 elapsed 算法**。前置 RCA 在 cp-05040101 文档写明了精确修复点（tick-helpers.js:120 + 153-156），但这一天所有人在 engine 侧的 stop-hook 改造里打转。

---

## 4. 修复建议（按优先级）

### P0-A：合 elapsed 算法修复（前置 RCA 选项 B + 补丁）

```js
// packages/brain/src/tick-helpers.js:120
// 优先用 started_at（每次派发会被 updateTask 重置），run_triggered_at 仅作 fallback
const triggeredAt = task.started_at || task.payload?.run_triggered_at;
```

同步改 `executor.js:3311` 和 `executor.js:3347`（liveness probe 两处），保持三处一致。

### P0-B：v2 workflow runtime 写齐 run_triggered_at

`dispatcher.js:_dispatchViaWorkflowRuntime` 调 runWorkflow 之前增加：

```js
await pool.query(
  `UPDATE tasks
   SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('run_triggered_at', NOW()::text)
   WHERE id = $1`,
  [taskToDispatch.id]
);
```

让 v2 路径也保持 `run_triggered_at` 与 `started_at` 同步。如果 P0-A 已落地（让 `run_triggered_at` 仅作 fallback），P0-B 可以延后；但同改一致性最高，复发风险最低。

### P0-C：先 deploy 修复，再人工 release 当前 quarantined 批次

```bash
# 拿到 quarantined task ids（Brain 起来后）
curl "localhost:5221/api/brain/tasks?status=quarantined&limit=50"
# 逐个 release
curl -X POST localhost:5221/api/brain/quarantine/{id}/release \
  -H 'Content-Type: application/json' \
  -d '{"action":"retry_once","reviewer":"rca-cp-05042136"}'
```

quarantine TTL 24h 自动 release，但**不修就再次撞同 bug 再次进 quarantine**，必须先 deploy P0-A/B 再 release。

### P2：patrol_cleanup 自循环检测告警

同一 task_id 在 30min 内出现 ≥3 次 patrol_cleanup → 写 `cecelia_events` 一条 `patrol_loop_suspect` 事件，触发告警。前置 RCA 已建议但未实施，**这是发现"修复回退"的关键 trip-wire**。

### P2：cancel 路径必填 reason

24h 内 `cancelled` 仍是 `error_message=NULL` 盲区（前置 RCA 桶 3 同问题）。优先级不变 P2。

---

## 5. 不再发生的措施（强化前置 RCA）

1. **RCA 文档写完后必须立即开 PR 修主诊（不留"等下个 sprint"）**。本次教训：cp-05040101 在 5/4 凌晨写完，到 5/4 21:36 仍有 26 个新失败，全因诊断变 PRD-only-words。
2. 任何"重置任务到 queued"路径必须在共享 helper 内完成 — 21 处散点 SET status=queued 应收编为 `revertToQueued(task_id)`，统一清空 `started_at + claimed_by + claimed_at + payload.run_triggered_at`。
3. v2 workflow runtime 与 v1 executor 的字段维护**必须签同一份合同**（设计文档强制列出 v2 接管后哪些字段由谁维护）。
4. 系统级"自愈"任务（PROBE_FAIL_*、Auto-Fix）入队前先做"自我兼容性检查"：如果即将派发的任务依赖的子系统正是它要修的那个，先写 quarantine 标记或绕道单独 runner。否则自愈系统永远撞自己。

---

## 6. 与前置 RCA 的关系

| 项 | cp-05040101 (5/4 01:01) | cp-05042136 (5/4 21:36，本文档) |
|---|---|---|
| 数据窗口 | 5/3 12:00 → 5/4 12:00 | 5/3 21:36 → 5/4 21:36 |
| 完成/失败 | 9/(20+16) | 14/26 |
| 根因 | tick-helpers.js:120 elapsed bug | **同上** |
| 修复状态 | 给方案，未合 | 未合 → 复发 |
| 新增 | — | v2 workflow runtime 加剧因素 + 三处共用 bug |

本文档不是对前置 RCA 的修订，而是**它没被采纳的实证**。下一步只有一件事：**开 PR 把 P0-A + P0-B 合掉**，否则下一个 24h 还会有第三轮 RCA。
