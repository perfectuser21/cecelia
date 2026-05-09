# Sprint Contract Draft (Round 2)

**Sprint**: W8 v15 真端到端验证（status=completed）
**journey_type**: autonomous
**Source PRD**: `sprints/w8-langgraph-v15/sprint-prd.md`

---

## Round 2 修订总结

回应 Reviewer round 1 反馈：

- **test_is_red 强化**：在 §E2E 验收 bash 最前面增加"测试红绿门"——`npx vitest run` 三个 WS 测试文件，红即 `exit 1`，把单测红绿绑进 exit code 链，不再只在 Test Contract 表格里文字声明。
- **internal_consistency 强化**：Step 1 / Step 2 / Step 3 改为"段落级 DoD 摘要"（保留每步 1-2 行核心断言便于评估器节点级理解），完整 bash 只在 §E2E 验收 出现一次。摘要里的引用用 `(详见 §E2E 验收 — 步骤 ①/②/③ 第 NN-MM 行)`，避免双份维护。
- 每个 WS 的"BEHAVIOR 覆盖测试文件"下增加"**未实现时跑 → exit=1，断言位置**"行，明示 Red 落点。

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

**完整验证命令**：详见 §E2E 验收 — 步骤 ① 派发（第 130-140 行）。

**硬阈值**：UUID 格式合法；DB 行存在；`created_at` 在最近 5 分钟内（防止用历史 INITIATIVE_ID 造假）；脚本耗时 < 30s。

---

### Step 2: 阻塞观察 LangGraph 跑通三阶段

**可观测行为**：脚本轮询 `initiative_runs.phase` 转换，记录每一阶段进入时间到 `.v15/timeline.log`；
直到 phase ∈ {done, failed} 或 30min 超时退出。timeline 文件至少含 1 条 entry，超时也记录 `TIMEOUT` entry。

**段落级 DoD 摘要**（核心断言，1-2 行）：
- `node scripts/v15-watch.mjs` 退出码 ∈ {0, 1}（0=终态正常，1=超时；2=连接/参数错误为不通过）
- `.v15/timeline.log` 非空且至少含一行匹配 `\t(A_contract|B_task_loop|C_final_e2e|done|failed|TIMEOUT)$`

**完整验证命令**：详见 §E2E 验收 — 步骤 ② 阻塞观察（第 142-153 行）。

**硬阈值**：watch exit ∈ {0, 1}；timeline.log 非空且格式合法；DB 中 initiative_runs 行存在且 phase 在合法集合内。

---

### Step 3: 终态判定 + 报告落盘

**可观测行为**：脚本读取 `.v15/timeline.log` + `tasks` + `initiative_runs` + sub-task 状态，
生成 `sprints/w8-langgraph-v15/run-report.md`，**必含**：
- `## Verdict: PASS|FAIL` 一行（恰好一个）
- `## Sprint Trinity Check` —— sprint-prd.md / sprint-contract.md / task-plan.json 三件齐全检查
- 如 Verdict=FAIL：`### Failure Node:` 段，含具体 LangGraph 节点名
  （取自 `tasks.error_message`、`initiative_runs.failure_reason`、`task_events`，至少一条非空）
- `## Generated at:` ISO timestamp

**段落级 DoD 摘要**（核心断言，1-2 行）：
- 报告文件 ≥ 500 bytes，且 `grep -cE '^## Verdict: (PASS|FAIL)$'` 恰好 = 1
- `## Generated at:` 时间戳在最近 1 小时内（防陈旧报告）；Verdict=FAIL 时必含 `### Failure Node: <node_name>` 段

**完整验证命令**：详见 §E2E 验收 — 步骤 ③ 报告（第 155-186 行）。

**硬阈值**：报告 ≥500 bytes；Verdict 行恰好 1 条；Generated at 在最近 1 小时内；三件齐全；
FAIL 时必含 Failure Node 段。

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

# === 步骤 ② 阻塞观察（内部 30min 超时） ===
set +e
node scripts/v15-watch.mjs "$INITIATIVE_ID"
WATCH_EXIT=$?
set -e
[ "$WATCH_EXIT" -eq 0 ] || [ "$WATCH_EXIT" -eq 1 ] \
  || { echo "FAIL: watch exit=$WATCH_EXIT (expected 0 or 1)"; exit 1; }

# timeline.log 体面 —— 至少一行 phase entry
[ -s .v15/timeline.log ] || { echo "FAIL: timeline.log empty"; exit 1; }
grep -Eq '\t(A_contract|B_task_loop|C_final_e2e|done|failed|TIMEOUT)$' .v15/timeline.log \
  || { echo "FAIL: timeline.log no phase entry"; exit 1; }

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
fi

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。

**FAIL 但合同仍 PASS 的情形**（PRD §边界情况）：
- v15 真实失败但报告诚实归因到具体节点（如 `### Failure Node: planner_node` + 错误日志摘要）→ 合同通过
- 这与 PRD 的"如果 v15 失败，根因要被准确归到具体节点"完全一致

**红绿门工作机制**：
- **实现前**（Round 2 当前提交时刻）：`scripts/v15-{dispatch,watch,report}.mjs` 全不存在，三个 vitest 文件全 import 失败 → `TEST_RC≠0` → 红绿门 exit 1，整段 E2E 不会跑
- **实现后**（Generator 写完三个 .mjs）：vitest GREEN → `TEST_RC=0` → 进入运行时 E2E

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
- **断言位置（实现后第一个变绿的关键断言）**：`expect(payload.initiative_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)`（dispatch.test.ts:13）

---

### Workstream 2: 观察脚本（scripts/v15-watch.mjs）

**范围**：Node.js 脚本，每 5s 轮询 `initiative_runs.phase` + `tasks.status`，
追加写 `.v15/timeline.log`（每行 `ISO_TIMESTAMP\tPHASE`）。直到 phase ∈ {done, failed} 或 30min 超时退出。
退出码 0=终态正常、1=超时、2=连接/参数错误。

**大小**：M（约 100-200 行）

**依赖**：WS1（消费 INITIATIVE_ID）

**实现要点**：
- 入参 `argv[2] = INITIATIVE_ID`，缺失 → exit 2
- 用 `pg` 轮询，`SELECT phase FROM initiative_runs WHERE initiative_id=$1 ORDER BY created_at DESC LIMIT 1`
- 同时查 `SELECT status FROM tasks WHERE id=$1`
- 每次 phase 变化才追加一行（去重，避免日志爆炸）
- 30min 硬上限：`setTimeout(() => { logTimelineEntry('TIMEOUT'); process.exit(1); }, 30*60*1000)`
- TIMEOUT 也必须 append 一行到 timeline.log

**BEHAVIOR 覆盖测试文件**：`tests/ws2/watch.test.ts`
- **未实现时跑 → exit=1**（`scripts/v15-watch.mjs` 不存在，全部 4 个 it() 在 import 阶段 ERR_MODULE_NOT_FOUND）
- **断言位置（实现后第一个变绿的关键断言）**：`expect(mod.isTerminalPhase('done')).toBe(true)`（watch.test.ts:11）

---

### Workstream 3: 报告生成器（scripts/v15-report.mjs）

**范围**：Node.js 脚本，读取 `.v15/timeline.log` + DB 查询（tasks / initiative_runs / sub-tasks /
task_events），写出 `sprints/w8-langgraph-v15/run-report.md`，含：
- `## Verdict: PASS|FAIL` 一行
- `## Sprint Trinity Check`（三件齐全）
- `## Timeline`（从 timeline.log 转 markdown 表）
- `## Initiative State`（initiative_runs 行 + 所有 sub-task 状态汇总）
- 若 FAIL：`### Failure Node:` 含具体 LangGraph 节点（取自 task_events 最后一条 error 事件 / failure_reason）
- `## Generated at:` ISO timestamp（脚本运行时刻）

**大小**：M（约 150-250 行）

**依赖**：WS2（消费 timeline.log）

**实现要点**：
- 入参 `argv[2] = INITIATIVE_ID`
- Verdict = PASS iff `tasks.status='completed'` AND `initiative_runs.phase='done'` AND 所有
  payload.parent_initiative_task_id=INIT 的 sub-task `status='completed'`；否则 FAIL
- Failure Node 提取规则：
  1. 优先 `task_events WHERE task_id=ANY(...) AND event_type LIKE '%error%' ORDER BY created_at DESC LIMIT 1`
  2. fallback `initiative_runs.failure_reason`
  3. fallback `tasks.error_message`
  4. 都没有 → "unknown_node (no failure_reason / error_message / task_events)"
- 报告写完后 `process.exit(0)`，即使 Verdict=FAIL 也 exit 0（合同验证另判）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/report.test.ts`
- **未实现时跑 → exit=1**（`scripts/v15-report.mjs` 不存在，全部 8 个 it() 在 import 阶段 ERR_MODULE_NOT_FOUND）
- **断言位置（实现后第一个变绿的关键断言）**：`expect(v).toBe('PASS')`（report.test.ts:16，computeVerdict 全绿条件返回 'PASS'）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/dispatch.test.ts` | 解析返回 UUID 格式合法；payload 结构含 initiative_id/prd/journey_type；缺 DATABASE_URL 时 exit 2 | WS1 → 4 failures（模块未实现，import ERR_MODULE_NOT_FOUND） |
| WS2 | `tests/ws2/watch.test.ts` | `isTerminalPhase('done')===true`；`isTerminalPhase('B_task_loop')===false`；timeline 行格式 `ISO\tPHASE`；超时退出码 1 | WS2 → 4 failures |
| WS3 | `tests/ws3/report.test.ts` | `computeVerdict({task_status:'completed', phase:'done', sub_tasks:[completed,completed]})==='PASS'`；任一 FAIL 即 'FAIL'；`extractFailureNode(events)` 优先取最后 error 事件；markdown 含必要段头 | WS3 → 8 failures |

**红绿门绑定**：上表"预期红证据"由 §E2E 验收 bash 顶部的 `npx vitest run` 直接跑出 `TEST_RC≠0`，
进而触发 `exit 1`，使得"实现前 E2E 不可能 PASS"成为 exit code 链的硬约束（不依赖人读 Test Contract 文字）。

---

## 与 PRD 的对应（覆盖完整性自审）

| PRD Golden Path 子项 | 对应合同 Step | 覆盖? |
|---|---|---|
| 触发：派发真实 harness Initiative（非 mock、非 dry-run） | Step 1 + WS1 dispatch.mjs INSERT 真任务 | ✅ |
| 系统处理：planner→proposer→generator→evaluator→absorption | Step 2 watch 观察 phase 转换（A_contract→B→C→done） | ✅ |
| Initiative status=completed | Step 3 Verdict 判定逻辑：tasks.status='completed' AND phase='done' | ✅ |
| 所有 sub-task status=completed，无 failed/stuck | Step 3 sub-task 汇总查询 | ✅ |
| sprint-prd / contract / task-plan 三件齐全且彼此一致 | Step 3 Trinity Check 段 | ✅ |
| 失败时节点级归因 | Step 3 FAIL 路径 + `### Failure Node:` 段 | ✅ |
| force APPROVED 必须显式记录 | task_events 抓 force_approved 事件，写入 Initiative State 段 | ✅（在 WS3 实现要点） |

PRD 边界情况"Brain 中途崩溃 → resume" / "absorption 无可吸收产物 skipped" 由 Brain 现有逻辑保证（PRD 范围限定明确"只验证不重构"），合同不重复测。
