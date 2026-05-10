# Child Initiative PRD — W8 v18 真端到端最小验证：在 docs/current/README.md 末尾追加一行时间戳

## 场景描述

我是 W8 LangGraph v18 父 Initiative（`98aef732-ce7d-4469-a156-fddbf7df4747`）的内层验证员。父 Initiative 的目标是验证 Brain LangGraph 五节点（Planner → Proposer GAN → Generator → Evaluator → Reporter）能在容器化环境真跑通到 `status='completed'` + `result.evaluator_verdict='APPROVED'` + 真 GitHub PR **MERGED** 的端态。

为了避免父子 Initiative 同名混淆，本 child Initiative 选定一个最小可观测的目标：**在 `docs/current/README.md` 文件末尾追加一行 `W8-v18 真跑验证 @ <ISO timestamp>`**。这个改动只触动一个文件、零业务逻辑、零依赖、CI 不会因此挂——它的全部价值在于"派生出 ≥4 类 `harness_*` 子任务、跑出真 PR、PR 真 MERGED"，借此**一次跑通**整个 LangGraph 闭环作为父 Initiative E2E 的可观测证据。

不在范围内：(i) 任何 `packages/brain/src/` 改动；(ii) 任何对父 Initiative 评分树或合同的反向修改；(iii) 任何凡是不能在 4 小时内自动跑完的目标（如重构、跨服务集成）；(iv) 帐户配额耗尽时的人工干预（直接降级为"在 sprints/ 下新建一个 `.md` 占位文件"备选目标）。

## Golden Path

[本 Sprint Generator 容器内 `POST /api/brain/tasks` 创建一行 `task_type='harness_initiative'`，body `metadata.parent_initiative_id="$TASK_ID"` + `metadata.child_prd_path="sprints/w8-langgraph-v18/child-prd.md"`]
→ [Brain LangGraph 自主跑完 Planner → Proposer GAN → Generator → Evaluator → Reporter 五节点，**全程容器化、调真账户、产真 GitHub PR 并 MERGED**]
→ [子 Initiative `tasks` 行 `status='completed'`、`result.evaluator_verdict='APPROVED'`、`result.pr_url` 是真实已 MERGED 的 GitHub PR、`result.report_path` 文件落地，且子任务全部 `completed`，Brain stdout 无 `PROBE_FAIL_*` / `BREAKER_OPEN` / `WORKTREE_KEY_COLLISION` / `STDOUT_LOST` / `EVALUATOR_DOD_NOT_FOUND` 等已知失败关键词]

具体步骤（≤5 步）：

1. **触发条件 — Generator POST 创建子 harness_initiative**
   - `POST localhost:5221/api/brain/tasks`
   - body: `{ "task_type": "harness_initiative", "payload": { "prd_text": "<§A 模板渲染后全文>" }, "metadata": { "parent_initiative_id": "$TASK_ID", "child_prd_path": "sprints/w8-langgraph-v18/child-prd.md" } }`
   - 返回 task_id 即 `child_initiative_id`，写入 harness-report.md frontmatter

2. **系统处理 — Brain LangGraph 自主跑 5 个节点**
   - Planner 节点拆 ≥1 个 task（"在 docs/current/README.md 末尾追加一行时间戳"）
   - Proposer / Reviewer GAN ≥1 轮直到 APPROVED → sprint-contract.md
   - Generator 节点 TDD 两次 commit 写 README + 推真 PR
   - Evaluator 节点真跑 DoD 命令 → APPROVED
   - Reporter 节点写 child Initiative 的 harness-report.md 进 PR diff

3. **可观测结果 — 子 task 行 + PR + report 文件**
   - `tasks` 行 `status='completed'`、`result.evaluator_verdict='APPROVED'`
   - `result.pr_url` HEAD 200 + `gh pr view --json state` 返回 `MERGED` + `mergedAt` 非空
   - `result.pr_url` 的 commits 中 ≥1 条 commit message 含 `child_initiative_id` 前 8 位
   - `result.report_path` 指向的文件在 PR worktree 真存在

## DoD 命令清单

> 至少 1 个 ```bash 代码块；每条命令 Evaluator 直接执行不解释；含硬阈值（exit code / 期望输出 / 时间窗口）。

```bash
# 全套硬阈值校验（exit 0 = 全过，否则 BLOCKED）
set -euo pipefail
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
REPORT="${SPRINT_DIR}/harness-report.md"
PARENT_ID="${TASK_ID:?TASK_ID 未注入}"

# 1. 报告 frontmatter 三字段齐全
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")
PARENT_FROM_REPORT=$(awk '/^parent_initiative_id:/ {print $2}' "$REPORT")
STDOUT_PATH=$(awk '/^stdout_file:/ {print $2}' "$REPORT")
[[ "$INIT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
[ "$PARENT_FROM_REPORT" = "$PARENT_ID" ]
[ -n "$STDOUT_PATH" ] && [ -f "$STDOUT_PATH" ]

# 2. 子 Initiative DB 行：metadata.parent_initiative_id 严格匹配（risk 2 mitigation）
curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}" \
  | jq -e --arg pid "$PARENT_ID" '
      .task_type == "harness_initiative"
      and .status == "completed"
      and .result.evaluator_verdict == "APPROVED"
      and (.metadata.parent_initiative_id == $pid)
    '

# 3. PR 真 MERGED + commits 含 INIT_ID 前 8 位（risk 3 mitigation）
PR_URL=$(curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}" | jq -r '.result.pr_url')
[[ "$PR_URL" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]]
curl -fsSI --max-time 15 "$PR_URL" | head -1 | grep -qE 'HTTP/[12](\.[01])? 200'
gh pr view "$PR_URL" --json state,mergedAt | jq -e '.state == "MERGED" and (.mergedAt | type == "string")'
INIT_PREFIX="${INIT_ID:0:8}"
gh pr view "$PR_URL" --json commits \
  | jq -e --arg p "$INIT_PREFIX" '.commits | length > 0 and (any(.[]; ((.messageHeadline // "") + " " + (.messageBody // "")) | test($p; "i")))'

# 4. Brain stdout 无已知失败关键词（risk 4 mitigation）
! grep -E 'PROBE_FAIL_|BREAKER_OPEN|WORKTREE_KEY_COLLISION|STDOUT_LOST|EVALUATOR_DOD_NOT_FOUND' "$STDOUT_PATH"

# 5. child-prd.md 三段 heading + DoD bash 代码块（risk 1 mitigation）
CHILD_PRD="${SPRINT_DIR}/child-prd.md"
grep -q '^## 场景描述' "$CHILD_PRD"
grep -q '^## Golden Path' "$CHILD_PRD"
grep -q '^## DoD 命令清单' "$CHILD_PRD"
awk '/^## DoD 命令清单/,/^## /' "$CHILD_PRD" | grep -q '^```bash'

# 6. BEHAVIOR 测试 5 个 it 全 PASS
npx vitest run "${SPRINT_DIR}/tests/ws1/harness-report-evidence.test.ts" --reporter=verbose

echo "✅ Child Initiative DoD 全过：W8 v18 真端到端跑通"
```

```bash
# 时间窗口防造假：6h 内派生 ≥4 种不同 harness_* completed 子任务
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
REPORT="${SPRINT_DIR}/harness-report.md"
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")
DB="${DB_URL:-postgresql://localhost/cecelia}"

COMPLETED_TYPES=$(psql "$DB" -tAc "SELECT count(DISTINCT task_type) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status='completed' AND created_at > NOW() - interval '6 hours' AND task_type LIKE 'harness\\_%'")
[ "${COMPLETED_TYPES:-0}" -ge 4 ]

FAILED=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status IN ('failed','stuck')")
[ "${FAILED:-1}" -eq 0 ]
```

## 附录

本 child PRD 严格按合同附录 §A 三段模板（`## 场景描述` / `## Golden Path` / `## DoD 命令清单`）渲染，DoD 段含两个可执行 ```bash 代码块；本附录为模板末尾收边节，不参与 contract `grep -q '^## ...'` 校验三段 heading（合同 §1 (c) 已锁死三段精确匹配语义）。
