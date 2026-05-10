# Sprint Contract Draft (Round 1)

**Initiative**: W8 LangGraph v18 真端到端验证
**Initiative Task ID**: 98aef732-ce7d-4469-a156-fddbf7df4747
**journey_type**: autonomous

---

## Golden Path

[本 Sprint Generator 容器内 POST /api/brain/tasks 创建一个最小子 `harness_initiative`]
→ [Brain LangGraph 全程自主跑完 Planner → Proposer GAN → Generator → Evaluator → Reporter，全程容器化、调真账户、真 GitHub PR]
→ [子 Initiative `tasks` 行 `status='completed'`，`result.evaluator_verdict='APPROVED'`、`result.pr_url` HTTP 200 真实 GitHub URL、`result.report_path` 文件落地，且子任务全部 completed、Brain stdout 无已知失败模式]
→ [本 Sprint Generator 把上述全部观测钉死在 `sprints/w8-langgraph-v18/harness-report.md` 的 frontmatter + 章节中]

---

### Step 1: Generator 触发一个最小子 Initiative

**可观测行为**: 在 Brain `tasks` 表中新增一行 `task_type='harness_initiative'` 的子任务，其 id 写入 `sprints/w8-langgraph-v18/harness-report.md` 的 frontmatter `child_initiative_id` 字段。Brain API 能立即查到该任务（status ∈ {queued, in_progress, completed}）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "${SPRINT_DIR}/harness-report.md")
[[ "$INIT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "FAIL: child_initiative_id 缺失或非 UUID"; exit 1; }
curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}" \
  | jq -e '.task_type == "harness_initiative" and (.status | IN("queued","in_progress","completed"))'
```

**硬阈值**: `child_initiative_id` 为合法 UUID v4 AND Brain API HTTP 200 AND `task_type='harness_initiative'` AND `status` ∈ {queued,in_progress,completed}（写报告时刻可能尚未终态，但终态由 Step 3 卡死）

---

### Step 2: Brain LangGraph 自主跑完 5 个节点，无人工干预、无已知失败模式

**可观测行为**: 子 Initiative 派生出 ≥4 类子任务（覆盖 `harness_planner` / `harness_contract_propose` / `harness_generate` / `harness_evaluate` / `harness_report` 至少 4 个），且这些子任务全部 `status='completed'`，无 `failed` / `stuck`；Brain stdout（`STDOUT_FILE`）未出现已知失败关键词（`PROBE_FAIL_*` / `BREAKER_OPEN` / `WORKTREE_KEY_COLLISION` / `STDOUT_LOST` / `EVALUATOR_DOD_NOT_FOUND`）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
DB="${DB_URL:-postgresql://localhost/cecelia}"
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "${SPRINT_DIR}/harness-report.md")

# (a) 时间窗口防造假：6 小时内派生且 completed 的不同 task_type ≥4
COMPLETED_TYPES=$(psql "$DB" -tAc "SELECT count(DISTINCT task_type) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status='completed' AND created_at > NOW() - interval '6 hours' AND task_type LIKE 'harness\\_%'")
[ "${COMPLETED_TYPES:-0}" -ge 4 ] || { echo "FAIL: 6h 内 completed harness_* task_type 仅 $COMPLETED_TYPES (<4)"; exit 1; }

# (b) 不允许任何 failed / stuck 子任务
FAILED=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status IN ('failed','stuck')")
[ "${FAILED:-1}" -eq 0 ] || { echo "FAIL: 失败/卡死子任务=$FAILED"; exit 1; }

# (c) Brain stdout 关键词扫描（找得到 STDOUT_FILE 才扫，找不到本步 SKIP 但记录到 stderr 让 Reporter 注意）
STDOUT_PATH="${STDOUT_FILE:-}"
if [ -n "$STDOUT_PATH" ] && [ -f "$STDOUT_PATH" ]; then
  ! grep -E 'PROBE_FAIL_|BREAKER_OPEN|WORKTREE_KEY_COLLISION|STDOUT_LOST|EVALUATOR_DOD_NOT_FOUND' "$STDOUT_PATH" \
    || { echo "FAIL: Brain stdout 命中已知失败关键词"; exit 1; }
else
  echo "WARN: STDOUT_FILE 未提供或不可读，跳过关键词扫描" >&2
fi
```

**硬阈值**:
- (a) 6 小时内 `parent_task_id=$INIT_ID AND status=completed AND task_type LIKE 'harness\_%'` 的不同 `task_type` ≥ 4
- (b) `parent_task_id=$INIT_ID AND status IN ('failed','stuck')` 计数 = 0
- (c) `STDOUT_FILE` 存在时不得含已知失败关键词；不存在时 WARN 但不 FAIL（写入 stderr，Reporter 必须记录）

> **GAN 防造假说明**：
> - `created_at > NOW() - interval '6 hours'` 阻断"用半年前的旧数据冒充本次真跑"
> - `task_type LIKE 'harness\_%'` 阻断"用同 parent 下的其他系统任务凑数"
> - `count(DISTINCT task_type) ≥ 4` 阻断"只跑了 1 个节点 4 次冒充全程"

---

### Step 3: 终态——子 Initiative 真 completed + APPROVED + 真 GitHub PR + report 文件落地

**可观测行为**: Brain API 返回的子 Initiative 行 `status='completed'`；`result.evaluator_verdict='APPROVED'`；`result.pr_url` 是 `https://github.com/` 开头的真实 URL 且 HEAD 请求 HTTP 200；`result.report_path` 指向的文件在 worktree 真存在（已 commit/push 进 PR diff）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "${SPRINT_DIR}/harness-report.md")
ROW=$(curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}")

# (a) status = completed
echo "$ROW" | jq -e '.status == "completed"' >/dev/null \
  || { echo "FAIL: status != completed"; exit 1; }

# (b) result.evaluator_verdict = APPROVED
echo "$ROW" | jq -e '.result.evaluator_verdict == "APPROVED"' >/dev/null \
  || { echo "FAIL: result.evaluator_verdict != APPROVED"; exit 1; }

# (c) pr_url 必须是 https://github.com/ 真链接 + HTTP 200
PR_URL=$(echo "$ROW" | jq -r '.result.pr_url // empty')
[[ "$PR_URL" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]] \
  || { echo "FAIL: pr_url 不是 github PR 链接 (实际=$PR_URL)"; exit 1; }
curl -fsSI --max-time 15 "$PR_URL" | head -1 | grep -qE 'HTTP/[12](\.[01])? 200' \
  || { echo "FAIL: pr_url HEAD != HTTP 200"; exit 1; }

# (d) report_path 文件真存在（worktree 内 OR PR 已 push 的 origin 分支可解析）
REPORT_PATH=$(echo "$ROW" | jq -r '.result.report_path // empty')
[ -n "$REPORT_PATH" ] || { echo "FAIL: report_path 为空"; exit 1; }
[ -f "$REPORT_PATH" ] || { echo "FAIL: report_path 文件不存在: $REPORT_PATH"; exit 1; }
```

**硬阈值**:
- (a) `.status == "completed"` 严格相等
- (b) `.result.evaluator_verdict == "APPROVED"` 严格相等
- (c) `pr_url` 必须匹配 `^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$` 且 HEAD 请求返回 HTTP 200（带 15s 超时防挂死）
- (d) `report_path` 文件在文件系统真实存在

> **GAN 防造假说明**：
> - `pr_url` 用正则锁死 PR 链接 shape，防止"贴个 github.com 首页"
> - `curl -fsSI` `-f` flag 让 5xx/4xx 直接非 0 退出（不会被 `| head` 假绿）
> - `report_path` 必须在 fs 真存在，不允许 result 字段乱写

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
DB="${DB_URL:-postgresql://localhost/cecelia}"
REPORT="${SPRINT_DIR}/harness-report.md"

# 0. 报告文件必须存在
[ -f "$REPORT" ] || { echo "FAIL: $REPORT 不存在"; exit 1; }

# 1. 提取 child_initiative_id（合法 UUID v4 才接受）
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")
[[ "$INIT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "FAIL: child_initiative_id 缺失或非 UUID (实际=$INIT_ID)"; exit 1; }

# 2. 子 Initiative 行必存在
ROW=$(curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}") \
  || { echo "FAIL: Brain API 不可达或 task ${INIT_ID} 不存在"; exit 1; }

# 3. status=completed
echo "$ROW" | jq -e '.status == "completed"' >/dev/null \
  || { echo "FAIL: status != completed"; exit 1; }

# 4. evaluator_verdict=APPROVED
echo "$ROW" | jq -e '.result.evaluator_verdict == "APPROVED"' >/dev/null \
  || { echo "FAIL: evaluator_verdict != APPROVED"; exit 1; }

# 5. pr_url 真可达（必须是 PR 链接 shape + HTTP 200）
PR_URL=$(echo "$ROW" | jq -r '.result.pr_url // empty')
[[ "$PR_URL" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]] \
  || { echo "FAIL: pr_url 非 PR 链接 (实际=$PR_URL)"; exit 1; }
curl -fsSI --max-time 15 "$PR_URL" | head -1 | grep -qE 'HTTP/[12](\.[01])? 200' \
  || { echo "FAIL: pr_url HEAD != HTTP 200"; exit 1; }

# 6. report_path 文件真实存在
REPORT_PATH=$(echo "$ROW" | jq -r '.result.report_path // empty')
[ -n "$REPORT_PATH" ] && [ -f "$REPORT_PATH" ] \
  || { echo "FAIL: report_path 缺失或文件不存在 (实际=$REPORT_PATH)"; exit 1; }

# 7. 子任务全 completed（≥4 类，6h 时间窗）+ 0 失败/卡死
COMPLETED_TYPES=$(psql "$DB" -tAc "SELECT count(DISTINCT task_type) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status='completed' AND created_at > NOW() - interval '6 hours' AND task_type LIKE 'harness\\_%'")
[ "${COMPLETED_TYPES:-0}" -ge 4 ] \
  || { echo "FAIL: 6h 内 completed harness_* task_type=${COMPLETED_TYPES} (<4)"; exit 1; }

FAILED=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status IN ('failed','stuck')")
[ "${FAILED:-1}" -eq 0 ] \
  || { echo "FAIL: failed/stuck 子任务 = $FAILED"; exit 1; }

# 8. Brain stdout 无已知失败关键词（STDOUT_FILE 存在时强校验，不存在时 WARN）
STDOUT_PATH="${STDOUT_FILE:-}"
if [ -n "$STDOUT_PATH" ] && [ -f "$STDOUT_PATH" ]; then
  if grep -E 'PROBE_FAIL_|BREAKER_OPEN|WORKTREE_KEY_COLLISION|STDOUT_LOST|EVALUATOR_DOD_NOT_FOUND' "$STDOUT_PATH"; then
    echo "FAIL: Brain stdout 命中已知失败关键词"; exit 1
  fi
else
  echo "WARN: STDOUT_FILE 未提供，跳过关键词扫描" >&2
fi

echo "✅ Golden Path 验证通过：W8 LangGraph v18 真端到端跑通到 status=completed + APPROVED"
```

**通过标准**: 脚本 `exit 0`

---

## Workstreams

workstream_count: 1

### Workstream 1: 触发最小子 Initiative + 监视 + 收证 + 写 harness-report.md

**范围**:
1. **选定小目标**：默认在 docs/current/README.md 末尾追加一行"W8-v18 真跑验证 @ <ISO timestamp>"作为最小可验证 Initiative 的 PRD 主体；Generator 可在执行时按账户配额降级到"在 sprints/ 下新建一个 .md 占位文件"。
2. **创建子任务**：`POST localhost:5221/api/brain/tasks` body 含 `task_type=harness_initiative` + 上述 PRD 文本，记录返回 task_id。
3. **监视终态**：循环 `GET /api/brain/tasks/<id>` 直到 `status ∈ {completed, failed}` 或超时 4 小时。
4. **收集证据**：
   - 子 Initiative `tasks` 行 JSON 全文（jq 美化后嵌入 Evidence 段）
   - 子任务清单（`SELECT id, task_type, status, created_at FROM tasks WHERE parent_task_id=$INIT_ID ORDER BY created_at`）
   - PR URL 的 HTTP 状态码（`curl -sI`）
   - Brain stdout（STDOUT_FILE）已知关键词扫描结果
5. **产出报告**：写 `sprints/w8-langgraph-v18/harness-report.md`，强制含 frontmatter 字段 `child_initiative_id` + 5 个章节（Final Status / Evaluator Verdict / Subtask Summary / Evidence / Residual Issues）。
6. **commit + push** 一个 PR；不修改 `packages/brain/src/`。

**大小**: M（脚本 + report 模板约 200 行 markdown/bash，无 brain 源码改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/harness-report-evidence.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（commit 1 阶段） |
|---|---|---|---|
| WS1 | `tests/ws1/harness-report-evidence.test.ts` | (1) `child_initiative_id` 是合法 UUID v4；(2) Final Status 段含 `completed`；(3) Evaluator Verdict 段含 `APPROVED`；(4) 至少 1 条 `https://github.com/.../pull/N` 形式的 PR URL；(5) Subtask Summary 列出 ≥4 个 `harness_*` task_type 且全 completed | harness-report.md 不存在 → loadReport throw → 5 个 it 全 fail |
