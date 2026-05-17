# 设计 — Harness Pipeline pre-merge gate + infra 修复

**日期**：2026-05-11
**PRD**：`docs/handoffs/2026-05-11-harness-pipeline-pre-merge-gate-fix.md`
**Worktree / 分支**：`harness-pre-merge-evaluator-gate` / `cp-0511182214-harness-pre-merge-evaluator-gate`
**前序 commit**：`6a51e6bef [CONFIG] feat(harness): 4 SKILL host 改动入 main`（SC-5 已落盘）

---

## 1. 架构决策（Approach A — per-task sub-graph 内嵌 pre-merge gate）

在 `harness-task.graph.js` 任务子图里，`poll_ci`（CI 绿）之后、`merge_pr` 之前插入新节点 `evaluate_contract`。verdict 决定走 `merge_pr`（PASS）或 `fix_dispatch`（FAIL）。

### 备选方案对比

| 方案 | 落点 | 优势 | 劣势 |
|---|---|---|---|
| **A. 任务子图内** ✅ | task.graph.js poll_ci → evaluate_contract → merge_pr | 单 PR 粒度，FAIL 不污染 main，PR 隔离 | 子图复杂度 +1 节点 |
| B. initiative 层聚合 | initiative.graph.js join 后 | 一次性整批校验 | 各 PR 已 merge 到 main，污染发生 |
| C. 混合 | 两层都加 | 鲁棒 | 双倍复杂度，TDD 难写 |

**选 A**：直接对齐 PRD 原意"evaluator 在 PR merge 之前跑"。最小侵入 — 只动 task graph 子图，initiative graph 仅做去重清理。

---

## 2. 组件分解

### 2.1 task.graph.js — 新节点 `evaluate_contract`

**位置**：`packages/brain/src/workflows/harness-task.graph.js`

**新增**：
- `evaluateContractNode(state, config)` async function（约 80-120 行）。
  - 读 `state.task.payload.contract_path`（contract-dod-ws{N}.md）。
  - 复用现有 spawn 机制派 task_type=`harness_evaluate` 子任务（task-router:129 已挂 `/harness-evaluator` skill）。
  - await callback；从 callback payload 解 verdict（`PASS`|`FAIL`）+ details。
  - 写回 state：`evaluate_verdict`、`evaluate_error`。

**StateAnnotation 扩字段**（task.graph.js 顶部 channels 定义）：
- `evaluate_verdict: { reducer: (_, v) => v, default: () => null }`
- `evaluate_error: { reducer: (_, v) => v, default: () => null }`

**拓扑**（addNode + edges 改动）：
```
spawn → await_callback → parse_callback → verify_generator → poll_ci
  ├─ pass → evaluate_contract
  │            ├─ PASS → merge_pr
  │            └─ FAIL → fix_dispatch
  └─ fail → fix_dispatch（不变）
```

- `routeAfterPoll`（line 418 附近）：'pass' 分支返回 `'evaluate'`（而非 `'merge'`）。
- 新增 `routeAfterEvaluate(state)`：`PASS → 'merge'`，`FAIL → 'fix'`。
- 新增 `.addNode('evaluate_contract', evaluateContractNode, { retryPolicy })`。
- 新增 `.addConditionalEdges('evaluate_contract', routeAfterEvaluate, { merge: 'merge_pr', fix: 'fix_dispatch' })`。

### 2.2 initiative.graph.js — 删冗余 `evaluate` 节点

**现状**（line 1467）：`addNode('evaluate', evaluateSubTaskNode, ...)` — 每个 sub-task 返回后跑 per-ws evaluator。

**改动**：
- **删除** `evaluate` 节点 +`evaluateSubTaskNode` function（per-task 评估已下沉到 task 子图的 `evaluate_contract`，此节点重复）。
- `run_sub_task → advance` 直连，跳过 `evaluate`。
- **保留** `final_evaluate`（line 1471）作 Golden Path 终验。
- 给 `final_evaluate` 顶部加注释："Golden Path 终验 — 跨 ws E2E 聚合验证，区别于 task 子图内的 evaluate_contract（per-task pre-merge gate）"。

**注**：SC-1 第 3 条 [BEHAVIOR] 检查 `/final_evaluate|Golden Path 终验|final E2E/`，注释加上即 PASS。

### 2.3 account-usage.js — Opus quota 字段

**Migration**：`packages/brain/migrations/220_account_usage_omelette.sql`
```sql
ALTER TABLE account_usage_cache
  ADD COLUMN seven_day_omelette_pct numeric DEFAULT 0,
  ADD COLUMN seven_day_omelette_resets_at timestamptz;
```

**fetchUsageFromAPI 解析**（line 404-410 附近）：
- 实测 Anthropic OAuth usage API（`api.anthropic.com/api/oauth/usage`）暂未直接暴露 Opus 单独 7-day quota。
- **方案**：upsert 时先尝试 `data.seven_day_opus?.utilization`（若 API 后续加），否则 fallback 用 `data.seven_day.utilization - data.seven_day_sonnet.utilization`（全模型 - Sonnet ≈ Opus + 其他）。
- 写 `seven_day_omelette_pct` 列。

**selectBestAccount**（line 535-641）：
- 新增条件分支：当 `options.model === 'opus'`，**跳过** `seven_day_omelette_pct >= 95` 的 account。
- 决策注释："Opus 7-day quota 接近上限，跳过避免 401。"

### 2.4 resource-tier.js — docker mem 升 2048

**位置**：`packages/brain/src/spawn/middleware/resource-tier.js`

**改动**（TASK_TYPE_TIER line 29-55）：
```js
  harness_planner: 'pipeline-heavy',          // 新增 / 原默认 light
  harness_contract_propose: 'pipeline-heavy', // 新增
  harness_contract_review: 'pipeline-heavy',  // 新增
```

- `pipeline-heavy` tier 已存在（2048 MB, line 22-27），直接复用，不动 RESOURCE_TIERS。
- planner 当前可能是 `harness_planner: 'light'`，需改 `'pipeline-heavy'`（实测 OOM 137）。

### 2.5 circuit-breaker.js — HALF_OPEN failures cap + 手动 reset 端点

**根因**：`recordFailure()` line 155 在 HALF_OPEN 下 `b.failures += 1` 无上限，导致 305 累积。

**改动 1（cap）**：
```js
if (b.state === 'HALF_OPEN') {
  // Probe failed → back to OPEN, but cap failures at FAILURE_THRESHOLD * 2
  // 避免长期累积干扰诊断，且保留"超阈值"信号
  b.failures = Math.min(b.failures + 1, FAILURE_THRESHOLD * 2);
  b.state = 'OPEN';
  b.openedAt = Date.now();
}
```

**改动 2（reset endpoint）**：
- 新增 `POST /api/brain/circuit-breaker/:key/reset` 路由（`packages/brain/src/server.js` 或既有 circuit-breaker 路由文件）。
- handler 调 `recordSuccess(key)`（已有逻辑会 `breakers.set(key, defaultState())`，failures 归 0、state=CLOSED）。
- SC-4 [BEHAVIOR] curl 命令直接 hit 这个端点。

### 2.6 Smoke test — `harness-pre-merge-gate-smoke.sh`

**位置**：`packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh`

**内容**：
1. POST 派 dry-run W28 任务（playground GET /divide）。
2. 轮询 task status；同时 watch docker logs。
3. 断言：evaluator container（task_type=harness_evaluate）启动 timestamp **早于** merge_pr 的 git push timestamp（证明 pre-merge gate 生效）。
4. exit 0 = PASS。

### 2.7 Unit tests

| 文件 | 用例 |
|---|---|
| `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` | (a) evaluate_contract PASS 路由 merge_pr，(b) evaluate_contract FAIL 路由 fix_dispatch，(c) poll_ci 'pass' 经过 evaluate 节点（不再直连 merge） |
| `packages/brain/src/__tests__/account-usage-omelette.test.js` | (a) Opus 模型 + omelette=96% → 跳过该 account，(b) Opus + omelette=50% → 正常选，(c) Sonnet 不受 omelette 影响 |
| `packages/brain/src/__tests__/circuit-breaker.test.js`（如无则新增） | (a) HALF_OPEN failure cap 不超 FAILURE_THRESHOLD*2，(b) reset endpoint → CLOSED + failures=0 |

### 2.8 E2E（SC-6）

PR merge + brain reload 后**手动**派 W28 真任务（PRD 中 curl 命令）。脚本在 Learning 文件里。不进 CI（耗时 60min+），属 post-merge 验收。

---

## 3. 数据流图

```
[Task sub-graph]
spawn(generator) ──► await_callback ──► parse ──► verify_generator
                                                       │
                                                       ▼
                                                  poll_ci (CI status)
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              ▼                        ▼                        ▼
                            fail                      pass                  timeout/error
                              │                        │                        │
                              ▼                        ▼                        ▼
                        fix_dispatch     ╔═════════════════════╗          (existing path)
                                         ║  evaluate_contract  ║◄── NEW
                                         ║ (spawn evaluator,   ║
                                         ║  await callback,    ║
                                         ║  parse verdict)     ║
                                         ╚═════════════════════╝
                                                       │
                                            ┌──────────┴──────────┐
                                            ▼                     ▼
                                          PASS                  FAIL
                                            │                     │
                                            ▼                     ▼
                                        merge_pr            fix_dispatch
```

---

## 4. 错误处理

| 场景 | 行为 |
|---|---|
| evaluator container 启动失败 | spawn 阶段 `recordFailure('cecelia-run')`，task 进 retry（最多 3 次），全失败 → terminal_fail |
| evaluator callback timeout（> 30 min） | 路由到 fix_dispatch（保守判 FAIL），保留日志供后续诊断 |
| Opus quota API 全无 omelette 字段 | fallback `seven_day - seven_day_sonnet`，绝不抛错（API 演进兼容） |
| circuit breaker reset 端点 hit 时 breaker 已 CLOSED | 幂等，仍返 200 + `{state: 'CLOSED'}` |
| Migration 在 live DB 跑 | `ADD COLUMN` 非 lock 操作，安全；rollback 通过 `DROP COLUMN IF EXISTS` |

---

## 5. 测试策略（金字塔分档）

| 改动 | 档位 | 落点 |
|---|---|---|
| `evaluateContractNode` 路由逻辑 | unit (vitest) | harness-task.graph.test.js |
| task 子图 conditionalEdges 拓扑 | unit (vitest) | harness-task.graph.test.js（3 路径覆盖） |
| selectBestAccount Opus omelette 跳过 | unit (vitest) | account-usage-omelette.test.js（新文件）|
| migration schema | integration | smoke 内 psql 验列存在 |
| circuit breaker failures cap | unit (vitest) | circuit-breaker.test.js |
| docker mem tier 映射 | unit (vitest) | resource-tier.test.js（若已有，加 1 case） |
| pre-merge gate 时序（evaluator before merge） | E2E smoke | harness-pre-merge-gate-smoke.sh |
| W28 真 pipeline | E2E manual | SC-6 在 Learning 验收 |

**TDD 纪律**：
- Commit 1（red）：新增 / 改测试文件 + 失败用例 + 空 smoke.sh 骨架。
- Commit 2（green）：实现让测试绿，smoke.sh 填实。
- subagent prompt 内嵌 4 条 TDD 红线（SKILL imperative）。

---

## 6. 受影响文件汇总

**新增（5 文件）**：
- `packages/brain/migrations/220_account_usage_omelette.sql`
- `packages/brain/src/__tests__/account-usage-omelette.test.js`
- `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh`
- `packages/brain/src/__tests__/circuit-breaker.test.js`（若不存在）
- `docs/learnings/cp-0511182214-harness-pre-merge-gate-fix.md`

**修改（6 文件）**：
- `packages/brain/src/workflows/harness-task.graph.js`（新 evaluate_contract 节点 + 路由）
- `packages/brain/src/workflows/harness-initiative.graph.js`（删 evaluate + 注释 final_evaluate）
- `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`（加 3 用例）
- `packages/brain/src/account-usage.js`（omelette upsert + selectBestAccount Opus skip）
- `packages/brain/src/spawn/middleware/resource-tier.js`（3 task_type → pipeline-heavy）
- `packages/brain/src/circuit-breaker.js`（failures cap）+ server.js reset endpoint

**已落盘（SC-5）**：commit `6a51e6bef` 包含 4 SKILL 文件。

---

## 7. 顺序与 commit 拆分

按 TDD + 模块独立性拆 4 个 commit：

1. **commit (red)**：测试文件 — task.graph.test.js + account-usage-omelette.test.js + circuit-breaker.test.js + smoke.sh 骨架。
2. **commit (green-1)**：task.graph.js evaluate_contract + initiative.graph.js 清理。
3. **commit (green-2)**：account-usage.js + migration + resource-tier.js + circuit-breaker.js。
4. **commit (final)**：smoke.sh 实现 + Learning 文件。

---

## 8. 验收锚点

PR CI（lint-test-pairing + lint-feature-has-smoke + lint-base-fresh + lint-tdd-commit-order）全绿 + smoke.sh 真环境绿 + merge → brain reload → 手动 W28 真任务 → task=completed。
