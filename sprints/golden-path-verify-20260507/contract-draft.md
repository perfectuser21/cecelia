# Sprint Contract Draft (Round 2)

> 验证 PR #2816：harness_initiative 任务执行完毕后 `tasks.status` 自动回写为终态（`completed` / `failed`），dispatcher 不再重复拉起。
> 本 Sprint **不修改 executor.js**，只构造端到端真实运行场景 + 复跑单元层断言。
> **journey_type**：autonomous

---

## 术语（Glossary）— 全合同唯一权威写法

为消除 PRD 残留的 `compiled.invoke()` 旧写法歧义，本合同后文一律用以下术语，**Reviewer / Generator / Evaluator 都以此为准**：

| 术语 | 唯一写法 | 含义 |
|---|---|---|
| Graph 调用入口 | `compiled.stream({ streamMode: 'updates' })` | LangGraph 编译后的子图执行入口，按 streamMode='updates' 逐节点 emit。**严禁**再写 `compiled.invoke()`、`compiled.stream/invoke`、`compiled.run` 等任何变体。 |
| Graph 节点事件 | `task_events.event_type = 'graph_node_update'` | streamMode='updates' 把每个节点输出 emit 到 `task_events` 表里的 row。 |
| Router 入口 | `runHarnessInitiativeRouter(task, { pool, compiled })` | executor.js 暴露的 harness_initiative 调度函数，封装 `compiled.stream(...)` + watchdog + writeback 副作用。 |
| 探针任务 | "fresh probe task" | Step 1 注入的 `_probe=true` harness_initiative 任务（**不是** `84075973-...` 自指任务）。 |
| 探针脚本 | `scripts/probe-harness-initiative-writeback.sh` | WS1 落盘的统一脚本，封装 Step 1–4 全部 shell 实现；E2E 验收脚本 `source` 它，**合同正文不复刻这些 shell**。 |

> 后文 Step 1–4 只描述**可观测行为契约**和**硬阈值**，shell 实现唯一存放点 = `scripts/probe-harness-initiative-writeback.sh`（WS1 产出）。E2E 验收脚本 `source` 该脚本入口。这样消除了 round 1 被 Reviewer 指出的"Step 1–5 与 E2E 章节脚本重复"问题（internal_consistency = 6 → 目标 ≥ 7）。

---

## Golden Path

[主理人触发 harness_initiative 任务] → [Brain dispatcher 派发 → executor 走 harness_initiative 分支 → `runHarnessInitiativeRouter` 调 `compiled.stream({ streamMode: 'updates' })`] → [graph 跑完所有阶段（PASS 或 FAIL）] → [`tasks.status` 写入 `completed` 或 `failed`，`completed_at` 非空] → [dispatcher 后续 tick 不再把这条 task_id 重新派发]

---

### Step 1: 触发一个真实 harness_initiative 任务（fresh probe task）

**可观测行为**: 在数据库 `tasks` 表插入一条 `task_type='harness_initiative'`、`status='queued'` 的新任务，6 分钟内被 dispatcher 拉起，状态变为 `in_progress`、`started_at` 非空。

**为何要 fresh task 不复用 `84075973-...`**：本 Initiative 自身正在跑（meta-recursive），它的 row 在测试期间 status 必然是 `in_progress`，无法用作"终态判定"样本。改造为：插入一条**最小可执行**的 harness_initiative 探针任务，观察其完整生命周期。

**硬阈值**:
- INSERT 必须带 `payload->>'_probe' = 'true'` 标记（用于事后清理 + 防误识为真任务）；
- `tasks WHERE id=$PROBE_TASK_ID` 的 `started_at` 在 6 分钟内非空（覆盖至少 1 个 5min tick + 余量）；
- `status` ∈ `{in_progress, completed, failed}`，**不是** `queued`；
- 严禁写 `WHERE id='84075973-...'`（自指悖论）。

**实现位置**: `scripts/probe-harness-initiative-writeback.sh` 内函数 `step1_inject_probe`。E2E 验收脚本 `source` 后调用。

---

### Step 2: graph 真的跑了且已停手

**可观测行为**: `task_events` 表至少出现 1 条 `event_type='graph_node_update'` 且 `task_id=$PROBE_TASK_ID` 的行（证明 `compiled.stream({ streamMode: 'updates' })` 真把 graph 节点 emit 出来），且最近 5 分钟内不再出现新的 `graph_node_update`（证明 graph 跑完终止，不是死循环）。

**硬阈值**:
- `task_events` 表中 `event_type='graph_node_update' AND task_id=$PROBE_TASK_ID AND created_at > NOW() - interval '60 minutes'` 的 count ≥ 1（必须带时间窗口防历史污染）；
- 最近 5 分钟内 `graph_node_update` count = 0（graph 已停手，不是死循环）；
- 静默观察至少持续到第一次连续 5min 无新 event（最长等待 18min，否则 FAIL）。

**实现位置**: `scripts/probe-harness-initiative-writeback.sh` 内函数 `step2_wait_graph_quiesce`。

---

### Step 3: tasks.status 写入终态（**核心断言**）

**可观测行为**: 探针任务的 `status` 字段最终值 ∈ `{completed, failed}`，**不是** `in_progress` 或 `queued`；`completed_at` 非空且 `>= started_at`。

**硬阈值**:
- `status` ∈ `{completed, failed}`（双终态，匹配 PRD"FAIL 也算闭环"）；
- `completed_at IS NOT NULL`；
- 时间戳比对必须用 SQL `(completed_at >= started_at)` 表达式，**严禁** shell 字符串/时区比较（防造假）；
- graph quiesce 后给 ≥ 90s 让 status writeback 落地。

**实现位置**: `scripts/probe-harness-initiative-writeback.sh` 内函数 `step3_assert_terminal`。

---

### Step 4: dispatcher 不再重复拉起这条 task_id

**可观测行为**: 终态落地后 10 分钟内，`run_events` 表中 `task_id=$PROBE_TASK_ID` 的活跃 run（`status IN ('running','queued')`）数量 = 0，且 `tasks.status` 不会被某个 tick 改回 `queued` / `in_progress`。

**硬阈值**:
- 观察窗 ≥ 10min（覆盖至少 2 个 5min tick 周期，避开"恰好这一 tick 没拉到所以假绿"）；
- 观察窗内 `tasks.status` 仍 ∈ `{completed, failed}`，未回退；
- `run_events` 中 `status IN ('running','queued') AND ts_start > NOW() - interval '10 minutes'` 的 count = 0；
- `tick_decisions` 中针对该 task_id 的 `payload->>'action' IN ('executor_failed','requeue','reschedule')` 决策 count = 0。

**实现位置**: `scripts/probe-harness-initiative-writeback.sh` 内函数 `step4_assert_no_requeue`。

---

### Step 5: 单元层守护断言不退化

**可观测行为**: 优先跑 PR #2816 自带的 `executor-harness-initiative-status-writeback.test.js`；若该文件**不存在**（PRD 假设的测试文件未在 main 上落地），fallback 跑 `tests/ws2/` 下本 Sprint 自补的 4 项 BEHAVIOR 单元测试。两者择一，不能缺。

**硬阈值**:
- 4 项断言全部 PASS（来自 PRD 引用文件 OR 本 Sprint 补的 fallback 测试）；
- 0 failed；
- 通过 `vitest --reporter=verbose` 输出，由 grep `✓` / `✗` 统计。

**实现位置**: 不入探针脚本（vitest 调用与 shell-only PG 探针解耦）。E2E 验收脚本 Step 5 直接 `npx vitest run` 调用，详见下方 §E2E 验收脚本。

---

## E2E 验收（最终 Evaluator 跑）— 唯一 shell 落点

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/golden-path-verify-20260507"
PROBE_SCRIPT="scripts/probe-harness-initiative-writeback.sh"

# === Step 1–4：source WS1 探针脚本，调用其 4 个 step 函数（合同正文不重复 shell） ===
[ -f "$PROBE_SCRIPT" ] || { echo "FAIL: WS1 artifact missing — $PROBE_SCRIPT"; exit 1; }
# shellcheck source=scripts/probe-harness-initiative-writeback.sh
source "$PROBE_SCRIPT"

step1_inject_probe          # 设置 PROBE_TASK_ID + 等 dispatcher 拉起（≤6min）
step2_wait_graph_quiesce    # 等 graph_node_update count ≥1 且最近 5min 静默
step3_assert_terminal       # 断言 status ∈ {completed,failed} 且 SQL 比对 completed_at>=started_at
step4_assert_no_requeue     # 10min 观察窗：无活跃 run、无 requeue tick_decisions

# === Step 5：单元层守护断言（vitest）— 不入探针脚本 ===
TEST_PATH="packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js"
if [ -f "$TEST_PATH" ]; then
  npx vitest run "$TEST_PATH" --reporter=verbose 2>&1 | tee /tmp/ws2-unit.log
else
  npx vitest run "$SPRINT_DIR/tests/ws2/" --reporter=verbose 2>&1 | tee /tmp/ws2-unit.log
fi
PASSED=$(grep -cE "✓" /tmp/ws2-unit.log || true)
FAILED=$(grep -cE "✗" /tmp/ws2-unit.log || true)
[ "$PASSED" -ge 4 ] && [ "$FAILED" -eq 0 ] || {
  echo "FAIL Step 5: vitest passed=$PASSED failed=$FAILED (expected passed>=4 failed=0)"
  exit 1
}

echo "✅ Golden Path 验证通过 (PROBE_TASK_ID=$PROBE_TASK_ID, 终态=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$PROBE_TASK_ID'"))"
```

**通过标准**: 脚本 exit 0；最终 echo 中 `终态=...` ∈ `{completed, failed}`。

> 设计意图：合同正文 Step 1–4 只列**行为契约 + 硬阈值**；shell 实现的唯一落点 = `scripts/probe-harness-initiative-writeback.sh`（WS1 ARTIFACT）；E2E 验收脚本 `source` 它。这样合同里**不存在**两份重复的 shell 块，回应 Reviewer round 1 的 internal_consistency = 6 反馈。

---

## Workstreams

workstream_count: 2

### Workstream 1: 端到端真实运行 + DB 终态断言

**范围**:
- 编写 `scripts/probe-harness-initiative-writeback.sh`，**必须**导出 4 个函数：`step1_inject_probe` / `step2_wait_graph_quiesce` / `step3_assert_terminal` / `step4_assert_no_requeue`，分别实现合同 Step 1–4 的硬阈值；
- 脚本 `set -euo pipefail`，任一函数失败 → 函数 return ≠ 0 → caller exit ≠ 0；
- 输出归档到 `${SPRINT_DIR}/run-${TIMESTAMP}/result.json`，含 PROBE_TASK_ID、终态、各 step 耗时；
- 不复用 `84075973-...`（自指悖论）。

**大小**: M（约 150–250 行 shell + jq）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/probe-status-writeback.test.ts`，**必须**含以下 4 个 `it()` 块（名称固定，便于 Evaluator grep 取证）：

| # | `it()` 名（精确字符串） |
|---|---|
| 1 | `Step 1: 脚本注入 fresh harness_initiative 任务（不复用 84075973-... 防自指）` |
| 2 | `Step 2: 脚本检查 graph_node_update event 至少 1 条 + 静默 5min（防死循环假绿）` |
| 3 | `Step 3: 终态断言用 SQL 比时间戳，不用 shell 字符串` |
| 4 | `Step 4: anti-requeue 观察窗 ≥ 10min 且检查 tick_decisions / run_events 双源` |

**TDD 纪律（commit 1 = Red, commit 2 = Green）— 强制项**:
- **commit 1（Red）**：仅落盘 `tests/ws1/probe-status-writeback.test.ts`，**不含** `scripts/probe-harness-initiative-writeback.sh`。运行：
  ```bash
  npx vitest run sprints/golden-path-verify-20260507/tests/ws1/probe-status-writeback.test.ts --reporter=verbose 2>&1 | tee /tmp/ws1-baseline-red.log
  ```
  必须满足：(a) 进程 exit ≠ 0；(b) `grep -cE "× .*(Step 1|Step 2|Step 3|Step 4)" /tmp/ws1-baseline-red.log` = **4**（4 项断言全 fail）。注意：vitest verbose 输出用 `×`（U+00D7 乘号）作 fail 标记而非 `✗`（U+2717），不要混。证据日志 `/tmp/ws1-baseline-red.log` 落盘到 `${SPRINT_DIR}/run-baseline-red/ws1-baseline-red.log`。
- **commit 2（Green）**：补 `scripts/probe-harness-initiative-writeback.sh` 实现 + 真实跑通后，4 项断言全转绿；exit = 0。
- CI / Evaluator 必须能从 commit 1 的日志确认"先红再绿"，不允许测试与实现同 commit 落盘。

---

### Workstream 2: 单元层守护断言（fallback）

**范围**:
- 跑 PR #2816 自带 `executor-harness-initiative-status-writeback.test.js`；
- 该文件不存在时 → 在 `tests/ws2/` 下补 4 项 BEHAVIOR 单元测试，覆盖：
  1. `runHarnessInitiativeRouter` 收到 graph `final={}`（无 error）→ 返回 `ok=true`；
  2. 收到 `final={error:'evaluator_fail'}` → 返回 `ok=false, finalState.error='evaluator_fail'`；
  3. `compiled.stream({ streamMode: 'updates' })` 抛 AbortError（watchdog）→ 写 `task.failure_class='watchdog_deadline'`，返回 `ok=false, error='watchdog_deadline'`；
  4. `compiled.stream({ streamMode: 'updates' })` 抛任意未知异常 → 异常向上抛（被外层 caller catch），不污染 task row。
- 复跑 dispatcher 现有 `dispatcher-default-graph.test.js`，确认 dispatcher 不会重选 status=completed/failed 的 task。

**大小**: M（约 150–250 行 TS + vitest）

**依赖**: 与 WS1 并行；E2E 脚本里 Step 5 依赖 WS2 产物存在。

**BEHAVIOR 覆盖测试文件**: `tests/ws2/status-writeback-unit.test.ts`，**必须**含以下 4 个 `it()` 块（名称固定）：

| # | `it()` 名（精确字符串） |
|---|---|
| 1 | `graph 返回 final={} (无 error) → router 返回 ok=true` |
| 2 | `graph 返回 final.error="evaluator_fail" → router 返回 ok=false` |
| 3 | `compiled.stream 抛 AbortError(watchdog) → 写 failure_class=watchdog_deadline 并返回 ok=false` |
| 4 | `compiled.stream 抛任意未知异常 → router 异常上抛（不静默吞）` |

**TDD 纪律（commit 1 = Red, commit 2 = Green）— 强制项**:
- **commit 1（Red）**：先落盘 `tests/ws2/status-writeback-unit.test.ts`，但 mock 的 `compiled` / `pool` 与生产签名**故意未对齐**（或不引入测试依赖、或被验证目标尚未导出）。运行：
  ```bash
  npx vitest run sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts --reporter=verbose 2>&1 | tee /tmp/ws2-baseline-red.log
  ```
  必须满足：(a) 进程 exit ≠ 0；(b) `grep -cE "× .*(graph 返回 final=\\{\\}|graph 返回 final\\.error=|compiled\\.stream 抛 AbortError|compiled\\.stream 抛任意未知异常)" /tmp/ws2-baseline-red.log` = **4**（4 项断言全 fail）。注意：vitest verbose 输出用 `×`（U+00D7 乘号）作 fail 标记而非 `✗`（U+2717）。证据日志落盘到 `${SPRINT_DIR}/run-baseline-red/ws2-baseline-red.log`。
- **commit 2（Green）**：补齐 mock 与导出 → 4 项断言全 PASS。
- 同 WS1：测试与实现严禁同 commit；CI / Evaluator 必须能从 commit 1 取到红日志。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（4 项 it()）| 预期红证据（commit 1） |
|---|---|---|---|
| WS1 | `tests/ws1/probe-status-writeback.test.ts` | (1) Step 1 探针注入；(2) Step 2 graph 静默；(3) Step 3 SQL 时间戳比对；(4) Step 4 anti-requeue 双源 | exit ≠ 0；`grep -cE "× .*(Step 1\|Step 2\|Step 3\|Step 4)" /tmp/ws1-baseline-red.log` = 4（× 是 vitest verbose 的 fail 标记 U+00D7） |
| WS2 | `tests/ws2/status-writeback-unit.test.ts` | (1) final={} → ok=true；(2) final.error → ok=false；(3) AbortError → failure_class=watchdog_deadline；(4) 未知异常 → 上抛 | exit ≠ 0；`grep -cE "× .*(graph 返回 final=\\{\\}\|graph 返回 final\\.error=\|compiled\\.stream 抛 AbortError\|compiled\\.stream 抛任意未知异常)" /tmp/ws2-baseline-red.log` = 4 |

---

## 验证命令规范自检（GAN 对抗焦点 — Reviewer 重点）

- [x] 所有 `SELECT count(*)` 都带时间窗口（`created_at > NOW() - interval 'X minutes'` / `ts_start > NOW() - interval 'X minutes'`），防止历史数据污染或手动 INSERT 造假；
- [x] 时间戳比较用 SQL `(completed_at >= started_at)`，规避 shell 字符串/时区造假；
- [x] 没有 `echo "ok"` / `true` 假绿验证；
- [x] `$PROBE_TASK_ID` 在 Step 1 注入后才被引用，`$DB` 由 cecelia-run 注入或 fallback `postgresql://localhost/cecelia`；
- [x] 探针用 fresh task 而非复用 `84075973-...`，避免"自指悖论"（meta-recursive 任务永远 in_progress）；
- [x] 终态判定接受 `{completed, failed}` 双终态，匹配 PRD"FAIL 也算闭环"；
- [x] Step 4 观察窗 = 10min（覆盖至少 2 个 5min tick 周期），避开"恰好这一 tick 没拉到所以假绿"；
- [x] Step 5 双路径设计应对 PRD 引用的 unit test 文件可能不存在的现实（避免 hard-coded 文件路径假绿）；
- [x] **shell 唯一落点 = `scripts/probe-harness-initiative-writeback.sh`**，合同正文不复刻；E2E 验收脚本 `source` 后调用；消除 round 1 internal_consistency = 6 反馈；
- [x] **graph 入口写法**全合同统一 `compiled.stream({ streamMode: 'updates' })`，PRD 残留的 `compiled.invoke()` 措辞在术语小节明确弃用；
- [x] **TDD 纪律**：每个 workstream 必须先 commit 红日志（4 项断言全 fail + exit ≠ 0），再 commit 实现转绿；CI 取证靠 `${SPRINT_DIR}/run-baseline-red/ws*-baseline-red.log`。

---

## 已知 PRD 风险登记（Risks Registered）

供 Reviewer 评估"是否需打回 PRD"：

1. **PR #2816 引用的测试文件 `executor-harness-initiative-status-writeback.test.js` 在当前 main 上不存在**（已 grep 确认）。Step 5 用 fallback 路径处理，但 PRD 假设可能不成立 → 建议 Reviewer 让 Planner 在下一轮明确：是 PRD 写错了文件名 / PR 没合上去 / 还是该测试本就要本 Sprint 自补。
2. **executor.js 的 harness_initiative 分支（lines 2964–2982）当前未直接调用 `updateTaskStatus`**——它返回 `{success: result.ok}`，由 dispatcher（line 480-495）按 `success` 判断"失败回退 queued / 成功放手"。状态 `completed/failed` 的实际写入路径可能在 callback worker / monitor-loop / run_events reconciler。本合同的 Step 3 只断言"终态可见"，不断言"由谁写"，对实现路径保持中立——这是优势（端到端不在意中间链路）也是风险（如果终态由 monitor-loop 兜底而非 executor 主动写，PRD 描述的"修复路径"就和现实有偏差）。建议 Reviewer 决定是否要求合同细化为"由 executor 主动调 updateTaskStatus"。
3. **PRD 文本残留 `compiled.invoke()` 旧写法**（sprint-prd.md L11/13/24/40）：本合同已在术语小节明确弃用并改写为 `compiled.stream({ streamMode: 'updates' })`，但 PRD 文件本身（planner artifact）未改。若 Reviewer 认为应连带修正 PRD，应在反馈中注明，由 Planner 在下一轮处理；本合同不越界改 planner 产物。
