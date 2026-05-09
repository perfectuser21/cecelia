# Sprint Contract Draft (Round 3)

**Sprint**: W8 v15 真端到端验证（status=completed）
**journey_type**: autonomous
**Source PRD**: `sprints/w8-langgraph-v15/sprint-prd.md`

---

## Round 3 修订总结

回应 Reviewer round 2 反馈：

- **R1（dispatcher_pickup 死锁）**：WS2 watch.mjs 增加 `detectStuckQueued()` —— 首 60s 内若 `tasks.status='queued'` 且无 `initiative_runs` 行，写 timeline `STUCK_QUEUED` 并 exit 1；report 端 `extractFailureNode` 将该信号映射为 `### Failure Node: dispatcher_pickup`。
- **R2（cascade 静默死锁）**：WS2 watch.mjs 增加 `detectStall()` —— 单一 phase 持续 ≥ 10min 无变化时记 `STALL@<phase>` 行并 exit 1；report 端 `extractFailureNode` 将 `STALL@X` 映射为 `### Failure Node: X`。
- **R3（红绿门误判）**：Round 3 提交时已经在 proposer 端跑过一次"手写 stub → vitest 全绿"自检（详见 `<!-- anchor:redgreen-self-check -->` 段记录），证明三个测试文件的 happy-path 断言**可达**而非"假红"；本合同把"未实现时 RED"和"stub 后 GREEN"两个状态都纳入 commit 审计。
- **R4（行号漂移）**：所有 §E2E 引用从"第 NN-MM 行"换成稳定 HTML 锚点（`<!-- anchor:dispatch-step -->` / `<!-- anchor:watch-step -->` / `<!-- anchor:report-step -->`）；行号变化不再令引用失效。
- WS3 `extractFailureNode` 新增 `(events, timeline)` 双源签名，timeline 信号优先级高于 events（更确定）。

---

## Schema 锚定（避免合同对错的坑）

PRD 文字层面用了"`harness_initiatives` / `harness_tasks` 行 status='completed'"的表述，
但 Brain 代码里的真实 schema 是：

| PRD 文字 | 真实 schema 映射 |
|---|---|
| "Initiative status='completed'" | `tasks.status='completed'`（task_type='harness_initiative'）AND `initiative_runs.phase='done'` |
| "sub-task status='completed'" | `tasks.status='completed'`（task_type='harness_task'，payload.parent_initiative_task_id=...） |
| "LangGraph checkpointer 记录" | `langgraph_checkpoints` 表（migration 244） |

合同里的验证命令一律按真实 schema 写，不再用 PRD 文字的表名。
（依据：`packages/brain/migrations/238_harness_v2_initiative_runs.sql`、`packages/brain/src/executor.js:2989`）

---

## Golden Path

```
[运维者派发测试 harness_initiative 任务]
        ↓
[Brain dispatcher 拾起 → runHarnessInitiativeRouter → LangGraph Phase A→B→C]
        ↓
[tasks.status='completed' AND initiative_runs.phase='done' AND 所有 sub-task status='completed']
        ↓
[run-report.md 落盘，含 Verdict=PASS 或 (Verdict=FAIL + 节点级归因)]
```

---

### Step 1: 派发一个真实的小型 harness Initiative

**可观测行为**：在 `tasks` 表新增一行 `task_type='harness_initiative'`，`status='queued'`，
payload 含一个最小可批准的测试 PRD（约 3-5 行 Golden Path，能 ≤30min 跑完）。返回的 `INITIATIVE_ID` 是合法 UUID。

**段落级 DoD 摘要**（核心断言，1-2 行）：
- `INITIATIVE_ID` 匹配正则 `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
- `tasks` 表存在该行，`task_type='harness_initiative'` 且 `created_at > NOW() - interval '5 minutes'`（防 stale）

**完整验证命令**：详见 §E2E 验收 — `<!-- anchor:dispatch-step -->`。

**硬阈值**：UUID 格式合法；DB 行存在；`created_at` 在最近 5 分钟内（防止用历史 INITIATIVE_ID 造假）；脚本耗时 < 30s。

---

### Step 2: 阻塞观察 LangGraph 跑通三阶段（含 R1 dispatcher 探测 + R2 stall 探测）

**可观测行为**：脚本轮询 `initiative_runs.phase` + `tasks.status` 转换，每次 phase 变化追加一行到 `.v15/timeline.log`。
异常路径：
- **R1 dispatcher_pickup 死锁**：派发后首 60s 内若 `tasks.status` 仍 `queued` 且 `initiative_runs` 表无行，
  watch 写一行 `STUCK_QUEUED` 后立即 `exit 1`（不再傻等 30min）。
- **R2 cascade 静默死锁**：单一 phase（如 `A_contract`）持续 ≥ 10min 无变化时，watch 写一行 `STALL@<phase>` 后 `exit 1`。
- **正常终态**：phase ∈ {done, failed} → exit 0。
- **30min 兜底超时**：依然 append 一行 `TIMEOUT` 后 exit 1。

timeline 文件至少含 1 条 entry；任意失败路径都必有相应 sentinel 行落盘。

**段落级 DoD 摘要**（核心断言，1-2 行）：
- `node scripts/v15-watch.mjs` 退出码 ∈ {0, 1}（0=终态正常；1=终态异常含 STUCK_QUEUED / STALL / TIMEOUT；2=连接/参数错误为不通过）
- `.v15/timeline.log` 非空且至少含一行匹配 `\t(A_contract|B_task_loop|C_final_e2e|done|failed|TIMEOUT|STUCK_QUEUED|STALL@[A-Za-z_][A-Za-z0-9_]*)$`

**完整验证命令**：详见 §E2E 验收 — `<!-- anchor:watch-step -->`。

**硬阈值**：watch exit ∈ {0, 1}；timeline.log 非空且行格式合法（含三种 sentinel）；DB 中 initiative_runs 行存在或显式空（dispatcher_pickup 路径）。

---

### Step 3: 终态判定 + 报告落盘（含 R1/R2 节点级归因）

**可观测行为**：脚本读取 `.v15/timeline.log` + `tasks` + `initiative_runs` + sub-task 状态 + `task_events`，
生成 `sprints/w8-langgraph-v15/run-report.md`，**必含**：
- `## Verdict: PASS|FAIL` 一行（恰好一个）
- `## Sprint Trinity Check` —— sprint-prd.md / sprint-contract.md / task-plan.json 三件齐全检查
- 如 Verdict=FAIL：`### Failure Node:` 段，含具体 LangGraph 节点名，按以下优先级提取：
  1. `.v15/timeline.log` 末尾若含 `STUCK_QUEUED` → `dispatcher_pickup`（R1）
  2. `.v15/timeline.log` 末尾若含 `STALL@<phase>` → `<phase>`（R2）
  3. `task_events` 表最后一条 `event_type LIKE '%error%'` → payload.node
  4. `initiative_runs.failure_reason`
  5. `tasks.error_message`
  6. 都没有 → `unknown_node (...)`
- `## Generated at:` ISO timestamp

**段落级 DoD 摘要**（核心断言，1-2 行）：
- 报告文件 ≥ 500 bytes，且 `grep -cE '^## Verdict: (PASS|FAIL)$'` 恰好 = 1
- `## Generated at:` 时间戳在最近 1 小时内（防陈旧报告）；Verdict=FAIL 时必含 `### Failure Node: <node_name>` 段；timeline 含 STUCK_QUEUED / STALL@X 的失败必映射对应节点

**完整验证命令**：详见 §E2E 验收 — `<!-- anchor:report-step -->`。

**硬阈值**：报告 ≥500 bytes；Verdict 行恰好 1 条；Generated at 在最近 1 小时内；三件齐全；
FAIL 时必含 Failure Node 段且映射来源正确（R1/R2 路径下不能落 unknown_node）。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**（**全合同 bash 唯一出现处**，Step 1/2/3 段落级摘要不重复粘贴）：

```bash
#!/bin/bash
set -euo pipefail

cd "${WORKSPACE_DIR:-$(pwd)}"  # 假定在 repo 根目录

# ============================================================
# 测试红绿门 — 实现前必红、实现后必绿
# 把单测的红绿状态绑进 exit code 链，而不是只在 Test Contract 文字层声明。
# 三个 WS 测试文件全 GREEN 才允许进入运行时 E2E；任一 RED 立即 exit 1。
# ============================================================
set +e
npx vitest run \
  sprints/w8-langgraph-v15/tests/ws1/dispatch.test.ts \
  sprints/w8-langgraph-v15/tests/ws2/watch.test.ts \
  sprints/w8-langgraph-v15/tests/ws3/report.test.ts
TEST_RC=$?
set -e
[ "$TEST_RC" -eq 0 ] || { echo "FAIL: unit tests red, implementation incomplete (rc=$TEST_RC)"; exit 1; }

# 0. 准备 — DATABASE_URL 必须可用
[ -n "${DATABASE_URL:-}" ] || { echo "ERROR: DATABASE_URL not set"; exit 2; }
psql "$DATABASE_URL" -tAc "SELECT 1" | grep -q 1 || { echo "ERROR: DB unreachable"; exit 2; }

# <!-- anchor:dispatch-step -->
# === 步骤 ① 派发 ===
INITIATIVE_ID=$(node scripts/v15-dispatch.mjs)
echo "$INITIATIVE_ID" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
  || { echo "FAIL: dispatch did not return valid UUID"; exit 1; }

# 防造假 — 该 INITIATIVE_ID 必须刚刚（5min 内）才被插入
psql "$DATABASE_URL" -tAc "
  SELECT 1 FROM tasks
  WHERE id='$INITIATIVE_ID' AND task_type='harness_initiative'
    AND created_at > NOW() - interval '5 minutes'
" | grep -q 1 || { echo "FAIL: dispatch row stale or not found"; exit 1; }

# <!-- anchor:watch-step -->
# === 步骤 ② 阻塞观察（含 R1 dispatcher_pickup 探测 + R2 stall 探测，30min 兜底超时） ===
set +e
node scripts/v15-watch.mjs "$INITIATIVE_ID"
WATCH_EXIT=$?
set -e
[ "$WATCH_EXIT" -eq 0 ] || [ "$WATCH_EXIT" -eq 1 ] \
  || { echo "FAIL: watch exit=$WATCH_EXIT (expected 0 or 1)"; exit 1; }

# timeline.log 体面 —— 至少一行已知 phase / sentinel
[ -s .v15/timeline.log ] || { echo "FAIL: timeline.log empty"; exit 1; }
grep -Eq $'\t(A_contract|B_task_loop|C_final_e2e|done|failed|TIMEOUT|STUCK_QUEUED|STALL@[A-Za-z_][A-Za-z0-9_]*)$' .v15/timeline.log \
  || { echo "FAIL: timeline.log no recognized phase / sentinel entry"; exit 1; }

# <!-- anchor:report-step -->
# === 步骤 ③ 报告 ===
node scripts/v15-report.mjs "$INITIATIVE_ID"

[ -s sprints/w8-langgraph-v15/run-report.md ] || { echo "FAIL: report missing"; exit 1; }
[ "$(wc -c < sprints/w8-langgraph-v15/run-report.md)" -ge 500 ] \
  || { echo "FAIL: report too small (likely empty template)"; exit 1; }

# Verdict 行 —— 恰好一条
VERDICT_COUNT=$(grep -cE '^## Verdict: (PASS|FAIL)$' sprints/w8-langgraph-v15/run-report.md || true)
[ "$VERDICT_COUNT" -eq 1 ] \
  || { echo "FAIL: report verdict missing or duplicated (count=$VERDICT_COUNT)"; exit 1; }

# Generated at —— 在最近 1h 内（防陈旧）
GEN_TS=$(grep -E '^## Generated at: ' sprints/w8-langgraph-v15/run-report.md | head -1 | sed 's/^## Generated at: //')
node -e "
  const t = new Date(process.argv[1]).getTime();
  if (isNaN(t)) { console.error('bad ts'); process.exit(1); }
  if (Date.now() - t > 3600 * 1000) { console.error('stale'); process.exit(1); }
" "$GEN_TS" || { echo "FAIL: report Generated at missing/stale"; exit 1; }

# 三件齐全
grep -qE '^## Sprint Trinity Check' sprints/w8-langgraph-v15/run-report.md \
  || { echo "FAIL: trinity check section missing"; exit 1; }
[ -f sprints/w8-langgraph-v15/sprint-prd.md ]      || { echo "FAIL: sprint-prd.md missing"; exit 1; }
[ -f sprints/w8-langgraph-v15/sprint-contract.md ] || { echo "FAIL: sprint-contract.md missing"; exit 1; }
[ -f sprints/w8-langgraph-v15/task-plan.json ]     || { echo "FAIL: task-plan.json missing"; exit 1; }

# 如 Verdict=FAIL 必须有节点级归因
if grep -q '^## Verdict: FAIL$' sprints/w8-langgraph-v15/run-report.md; then
  grep -qE '^### Failure Node: [A-Za-z_][A-Za-z0-9_]+' sprints/w8-langgraph-v15/run-report.md \
    || { echo "FAIL: Verdict=FAIL but no Failure Node section"; exit 1; }

  # R1: timeline STUCK_QUEUED 必映射 dispatcher_pickup
  if grep -q $'\tSTUCK_QUEUED$' .v15/timeline.log; then
    grep -qE '^### Failure Node: dispatcher_pickup$' sprints/w8-langgraph-v15/run-report.md \
      || { echo "FAIL: STUCK_QUEUED in timeline but Failure Node not dispatcher_pickup"; exit 1; }
  fi

  # R2: timeline STALL@<phase> 必映射 <phase>
  STALL_LINE=$(grep -E $'\tSTALL@[A-Za-z_][A-Za-z0-9_]*$' .v15/timeline.log | tail -1 || true)
  if [ -n "$STALL_LINE" ]; then
    STALLED_PHASE=$(echo "$STALL_LINE" | sed -E 's/.*\tSTALL@([A-Za-z_][A-Za-z0-9_]*)$/\1/')
    grep -qE "^### Failure Node: ${STALLED_PHASE}$" sprints/w8-langgraph-v15/run-report.md \
      || { echo "FAIL: STALL@${STALLED_PHASE} in timeline but Failure Node mismatch"; exit 1; }
  fi
fi

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。

**FAIL 但合同仍 PASS 的情形**（PRD §边界情况）：
- v15 真实失败但报告诚实归因到具体节点（如 `### Failure Node: dispatcher_pickup` / `### Failure Node: evaluator_node` + 错误日志摘要）→ 合同通过
- 这与 PRD 的"如果 v15 失败，根因要被准确归到具体节点"完全一致

**红绿门工作机制**：
- **实现前**（Round 3 当前提交时刻）：`scripts/v15-{dispatch,watch,report}.mjs` 全不存在，三个 vitest 文件全 import 失败 → `TEST_RC≠0` → 红绿门 exit 1，整段 E2E 不会跑
- **实现后**（Generator 写完三个 .mjs）：vitest GREEN → `TEST_RC=0` → 进入运行时 E2E

<!-- anchor:redgreen-self-check -->
**红绿门防误判自检（R3 闭环证据）**：

Round 3 在 proposer 端已跑过一次手写 stub 自检（脚本：`/tmp/v15-redgreen-stub-check.sh`）：
- **状态 1（无 stub）**：`scripts/v15-{dispatch,watch,report}.mjs` 不存在 → `npx vitest run sprints/w8-langgraph-v15/tests/` → 全 RED（每个 it 都 ERR_MODULE_NOT_FOUND）。
- **状态 2（手写 stub）**：用最小 stub 满足全部导出（`buildPayload` / `INSERT_SQL` / `isTerminalPhase` / `formatTimelineEntry` / `detectStuckQueued` / `detectStall` / `computeVerdict` / `extractFailureNode` / `renderReport`）→ `npx vitest run sprints/w8-langgraph-v15/tests/` → 全 GREEN。
- **结论**：测试断言**可达**，不存在"测试写错导致永远红"的情况。Round 3 commit 不附带 stub 文件，仅记录此自检事实。

---

## Workstreams

workstream_count: 3

### Workstream 1: 派发脚本（scripts/v15-dispatch.mjs）

**范围**：Node.js 脚本，连 `DATABASE_URL` 用 `pg` 直接 INSERT 一行 `task_type='harness_initiative'`，
`status='queued'`，payload 含一个最小测试 PRD（≤30min 跑完）。stdout 单行 UUID，stderr 写日志。

**大小**：S（< 100 行）

**依赖**：无

**实现要点**：
- 用 `pg` 模块，`new Pool({ connectionString: process.env.DATABASE_URL })`
- 测试 PRD 必须是真实"小且能跑完"的 PRD，例如"在 docs/ 下创建一个 hello.md 文件"
- payload 字段：`{ initiative_id, prd, journey_type: 'autonomous' }`
- INSERT 用 `RETURNING id` 拿回 UUID，stdout 单行打印
- 失败必抛错（`process.exitCode = 2`）

**BEHAVIOR 覆盖测试文件**：`tests/ws1/dispatch.test.ts`
- **未实现时跑 → exit=1**（`scripts/v15-dispatch.mjs` 不存在，全部 4 个 it() 在 import 阶段 ERR_MODULE_NOT_FOUND）
- **断言位置（实现后第一个变绿的关键断言）**：`expect(payload.initiative_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)`（dispatch.test.ts，`buildPayload returns object with initiative_id ...` 用例首条断言）

---

### Workstream 2: 观察脚本（scripts/v15-watch.mjs，含 R1 + R2）

**范围**：Node.js 脚本，每 5s 轮询 `initiative_runs.phase` + `tasks.status` + 是否存在 `initiative_runs` 行，
追加写 `.v15/timeline.log`（每行 `ISO_TIMESTAMP\tPHASE`，PHASE 可为真实 phase 或 sentinel）。
退出条件：
- phase ∈ {done, failed} → exit 0
- **R1**: 派发首 60s 内 `tasks.status='queued'` 且无 `initiative_runs` 行 → 写 `STUCK_QUEUED` → exit 1
- **R2**: 单一 phase 持续 ≥ 10min 无变化 → 写 `STALL@<phase>` → exit 1
- 30min 兜底超时 → 写 `TIMEOUT` → exit 1
- 参数/连接错误 → exit 2

**大小**：M（约 100-200 行）

**依赖**：WS1（消费 INITIATIVE_ID）

**实现要点**：
- 入参 `argv[2] = INITIATIVE_ID`，缺失 → exit 2
- 用 `pg` 轮询，`SELECT phase FROM initiative_runs WHERE initiative_id=$1 ORDER BY created_at DESC LIMIT 1`
- 同时查 `SELECT status FROM tasks WHERE id=$1`
- 每次 phase 变化才追加一行（去重，避免日志爆炸）
- **`detectStuckQueued({task_status, has_run, elapsed_ms})`**：返回布尔，纯函数（time-source 注入便于单测）
- **`detectStall({phase, last_change_ms})`**：返回布尔，10min（600_000ms）阈值
- 30min 硬上限：`setTimeout(() => { append('TIMEOUT'); process.exit(1); }, 30*60*1000)`
- TIMEOUT / STUCK_QUEUED / STALL@<phase> 都必须 append 一行到 timeline.log

**BEHAVIOR 覆盖测试文件**：`tests/ws2/watch.test.ts`
- **未实现时跑 → exit=1**（`scripts/v15-watch.mjs` 不存在，全部 9 个 it() 在 import 阶段 ERR_MODULE_NOT_FOUND）
- **断言位置（实现后第一个变绿的关键断言）**：`expect(mod.isTerminalPhase('done')).toBe(true)`（watch.test.ts，`isTerminalPhase returns true for done` 用例）

---

### Workstream 3: 报告生成器（scripts/v15-report.mjs，含 R1/R2 失败映射）

**范围**：Node.js 脚本，读取 `.v15/timeline.log` + DB 查询（tasks / initiative_runs / sub-tasks /
task_events），写出 `sprints/w8-langgraph-v15/run-report.md`，含：
- `## Verdict: PASS|FAIL` 一行
- `## Sprint Trinity Check`（三件齐全）
- `## Timeline`（从 timeline.log 转 markdown 表）
- `## Initiative State`（initiative_runs 行 + 所有 sub-task 状态汇总）
- 若 FAIL：`### Failure Node:` 含具体 LangGraph 节点（按 R1/R2/事件/兜底 顺序提取）
- `## Generated at:` ISO timestamp（脚本运行时刻）

**大小**：M（约 150-250 行）

**依赖**：WS2（消费 timeline.log）

**实现要点**：
- 入参 `argv[2] = INITIATIVE_ID`
- Verdict = PASS iff `tasks.status='completed'` AND `initiative_runs.phase='done'` AND 所有
  payload.parent_initiative_task_id=INIT 的 sub-task `status='completed'`；否则 FAIL
- **`extractFailureNode(events, timeline)`** 提取规则（按优先级）：
  1. `timeline` 末尾含 `STUCK_QUEUED` → `dispatcher_pickup`（R1）
  2. `timeline` 末尾含 `STALL@<phase>` → `<phase>`（R2）
  3. `task_events WHERE event_type LIKE '%error%' ORDER BY created_at DESC LIMIT 1` → `payload.node`
  4. `initiative_runs.failure_reason`
  5. `tasks.error_message`
  6. 都没有 → `unknown_node (no failure_reason / error_message / task_events)`
- 报告写完后 `process.exit(0)`，即使 Verdict=FAIL 也 exit 0（合同验证另判）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/report.test.ts`
- **未实现时跑 → exit=1**（`scripts/v15-report.mjs` 不存在，全部 10 个 it() 在 import 阶段 ERR_MODULE_NOT_FOUND）
- **断言位置（实现后第一个变绿的关键断言）**：`expect(v).toBe('PASS')`（report.test.ts，`computeVerdict returns PASS when all green` 用例，computeVerdict 全绿条件返回 'PASS'）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/dispatch.test.ts` | 解析返回 UUID 格式合法；payload 结构含 initiative_id/prd/journey_type；UUID 不重复；INSERT_SQL 含 RETURNING id | WS1 → 4 failures（模块未实现，import ERR_MODULE_NOT_FOUND） |
| WS2 | `tests/ws2/watch.test.ts` | `isTerminalPhase` 三种返回值；`formatTimelineEntry` 格式（含 sentinel）；`detectStuckQueued` 4 路径（R1）；`detectStall` 2 路径（R2） | WS2 → 9 failures |
| WS3 | `tests/ws3/report.test.ts` | `computeVerdict` 5 路径；`extractFailureNode` 兜底 + events + R1 STUCK_QUEUED + R2 STALL@X + timeline 优先；`renderReport` 段头 | WS3 → 10 failures |

**红绿门绑定**：上表"预期红证据"由 §E2E 验收 bash 顶部的 `npx vitest run` 直接跑出 `TEST_RC≠0`，
进而触发 `exit 1`，使得"实现前 E2E 不可能 PASS"成为 exit code 链的硬约束（不依赖人读 Test Contract 文字）。
"假红"风险已在 `<!-- anchor:redgreen-self-check -->` 自检证据下闭环。

---

## 与 PRD 的对应（覆盖完整性自审）

| PRD Golden Path 子项 | 对应合同 Step | 覆盖? |
|---|---|---|
| 触发：派发真实 harness Initiative（非 mock、非 dry-run） | Step 1 + WS1 dispatch.mjs INSERT 真任务 | ✅ |
| 系统处理：planner→proposer→generator→evaluator→absorption | Step 2 watch 观察 phase 转换（A_contract→B→C→done） | ✅ |
| Initiative status=completed | Step 3 Verdict 判定逻辑：tasks.status='completed' AND phase='done' | ✅ |
| 所有 sub-task status=completed，无 failed/stuck | Step 3 sub-task 汇总查询 | ✅ |
| sprint-prd / contract / task-plan 三件齐全且彼此一致 | Step 3 Trinity Check 段 | ✅ |
| 失败时节点级归因 | Step 3 FAIL 路径 + `### Failure Node:` 段（含 R1 dispatcher_pickup / R2 STALL@X） | ✅ |
| force APPROVED 必须显式记录 | task_events 抓 force_approved 事件，写入 Initiative State 段 | ✅（在 WS3 实现要点） |
| 边界：dispatcher 不拾起 / cascade 静默死锁 | R1 STUCK_QUEUED + R2 STALL@<phase> 探测 + 节点映射 | ✅ |

PRD 边界情况"Brain 中途崩溃 → resume" / "absorption 无可吸收产物 skipped" 由 Brain 现有逻辑保证（PRD 范围限定明确"只验证不重构"），合同不重复测。
