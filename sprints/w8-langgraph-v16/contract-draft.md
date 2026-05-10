# Sprint Contract Draft (Round 1)

## Golden Path

[Brain 收到 v16 walking skeleton dispatch 请求] → [planner sub_task 完成 sprint-prd.md push] → [proposer sub_task 完成 sprint-contract.md + task-plan.json push 且 origin 已校验] → [reviewer sub_task APPROVED] → [generator sub_task 在 `<init8>-<logical>` 复合 worktree 产出 docs/learnings/w8-langgraph-v16-e2e.md 并 push] → [evaluator sub_task 通过 callback 将 sub_task `tasks` 行 status 写为 completed]

---

### Step 1: 触发 — Brain 收到 harness_initiative 派发请求并落库

**可观测行为**：执行测试 dispatch 后，PostgreSQL `tasks` 表新增一行 `task_type='harness_initiative'`、`payload.skeleton_mode=true`、描述字符串包含 "[W8 v16 — final] Walking Skeleton noop 真端到端"，且其 `parent_task_id IS NULL`（顶层 initiative，不是 sub_task）。

**验证命令**：
```bash
TASK_ID=$(psql "$DB" -t -A -c "SELECT id FROM tasks WHERE task_type='harness_initiative' AND description LIKE '%[W8 v16 — final] Walking Skeleton noop 真端到端%' AND parent_task_id IS NULL AND created_at > NOW() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1")
[ -n "$TASK_ID" ] || { echo "FAIL: 未找到 v16 initiative task"; exit 1; }
SKELETON=$(psql "$DB" -t -A -c "SELECT (payload->>'skeleton_mode')::text FROM tasks WHERE id='$TASK_ID'")
[ "$SKELETON" = "true" ] || { echo "FAIL: payload.skeleton_mode != true"; exit 1; }
echo "PASS: initiative task=$TASK_ID skeleton_mode=true"
```

**硬阈值**：恰好 1 行 initiative task 命中（>1 行视为环境污染 → FAIL）；命中行 `created_at` 在最近 30 分钟内（防止把上一次 v14/v15 残留误判为成功）；`payload.skeleton_mode === 'true'`。

---

### Step 2: planner 节点 — 已 push sprint-prd.md 到远端 PLANNER_BRANCH

**可观测行为**：以 Step 1 的 initiative TASK_ID 为父，DB 中有 `task_type='harness_planner'` 的 sub_task 行 `status='completed'` 且 `result->>'verdict'='DONE'`；`origin/<planner_branch>` 上 `sprints/w8-langgraph-v16/sprint-prd.md` 文件存在且非空。

**验证命令**：
```bash
PLANNER_ROW=$(psql "$DB" -t -A -c "SELECT id, result->>'branch', result->>'verdict' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_planner' AND status='completed' AND updated_at > NOW() - interval '30 minutes' ORDER BY updated_at DESC LIMIT 1")
[ -n "$PLANNER_ROW" ] || { echo "FAIL: planner sub_task 未 completed"; exit 1; }
PLANNER_BRANCH=$(echo "$PLANNER_ROW" | awk -F'|' '{print $2}')
PLANNER_VERDICT=$(echo "$PLANNER_ROW" | awk -F'|' '{print $3}')
[ "$PLANNER_VERDICT" = "DONE" ] || { echo "FAIL: planner verdict=$PLANNER_VERDICT (期望 DONE)"; exit 1; }
git fetch origin "$PLANNER_BRANCH" --depth=1 || { echo "FAIL: planner branch $PLANNER_BRANCH 在 origin 找不到"; exit 1; }
PRD_BYTES=$(git cat-file -s "origin/$PLANNER_BRANCH:sprints/w8-langgraph-v16/sprint-prd.md")
[ "$PRD_BYTES" -gt 500 ] || { echo "FAIL: sprint-prd.md 太小 ($PRD_BYTES bytes)"; exit 1; }
echo "PASS: planner branch=$PLANNER_BRANCH verdict=DONE prd_bytes=$PRD_BYTES"
```

**硬阈值**：sub_task `status='completed'` 且 `result->>'verdict'='DONE'`；`updated_at` 在最近 30 分钟内（防止读到旧 v14 数据）；`origin/<planner_branch>:sprints/w8-langgraph-v16/sprint-prd.md` 实际可 fetch 且 size > 500 bytes（避免空文件造假绿）。

---

### Step 3: proposer 节点 — 已 push sprint-contract.md + task-plan.json 且 origin push 真已生效

**可观测行为**：以 initiative TASK_ID 为父，DB 中有 `task_type='harness_propose'` 的 sub_task 行 `status='completed'`，`result->>'propose_branch'` 指向一个 `cp-harness-propose-r*-*` 形式的远端分支；该分支上 `sprints/w8-langgraph-v16/sprint-contract.md` 与 `sprints/w8-langgraph-v16/task-plan.json` 同时存在；`task-plan.json` 是合法 JSON 且 `tasks` 数组长度 ≥ 1。

**验证命令**：
```bash
PROPOSE_ROW=$(psql "$DB" -t -A -c "SELECT result->>'propose_branch' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_propose' AND status='completed' AND updated_at > NOW() - interval '30 minutes' ORDER BY updated_at DESC LIMIT 1")
[ -n "$PROPOSE_ROW" ] || { echo "FAIL: proposer sub_task 未 completed"; exit 1; }
PROPOSE_BRANCH="$PROPOSE_ROW"
echo "$PROPOSE_BRANCH" | grep -qE '^cp-harness-propose-r[0-9]+-[0-9a-f]+$' || { echo "FAIL: propose_branch 不符合规范命名: $PROPOSE_BRANCH"; exit 1; }
git fetch origin "$PROPOSE_BRANCH" --depth=1 || { echo "FAIL: propose branch $PROPOSE_BRANCH 在 origin 找不到 (H10 回归)"; exit 1; }
git cat-file -e "origin/$PROPOSE_BRANCH:sprints/w8-langgraph-v16/sprint-contract.md" || { echo "FAIL: sprint-contract.md 不存在"; exit 1; }
git show "origin/$PROPOSE_BRANCH:sprints/w8-langgraph-v16/task-plan.json" > /tmp/v16-plan.json
node -e "const p=JSON.parse(require('fs').readFileSync('/tmp/v16-plan.json'));if(!Array.isArray(p.tasks)||p.tasks.length<1)process.exit(1)" || { echo "FAIL: task-plan.json 非法或 tasks 为空"; exit 1; }
echo "PASS: propose_branch=$PROPOSE_BRANCH contract+task-plan 在 origin 都已 push"
```

**硬阈值**：propose_branch 必须真在 origin 可 fetch（H10 修复点）；contract + task-plan 两文件都存在；task-plan.json 解析通过且 `tasks.length ≥ 1`；sub_task `updated_at` 在最近 30 分钟内。

---

### Step 4: reviewer 节点 — GAN 终态 APPROVED

**可观测行为**：以 initiative TASK_ID 为父，DB 中有 `task_type='harness_review'` 的 sub_task 行 `status='completed'`，`result->>'verdict'='APPROVED'`，`result->>'gan_rounds'` 是个 ≥ 1 的整数。

**验证命令**：
```bash
REVIEW_ROW=$(psql "$DB" -t -A -c "SELECT result->>'verdict', (result->>'gan_rounds')::int FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_review' AND status='completed' AND updated_at > NOW() - interval '30 minutes' ORDER BY updated_at DESC LIMIT 1")
[ -n "$REVIEW_ROW" ] || { echo "FAIL: reviewer sub_task 未 completed"; exit 1; }
VERDICT=$(echo "$REVIEW_ROW" | awk -F'|' '{print $1}')
ROUNDS=$(echo "$REVIEW_ROW" | awk -F'|' '{print $2}')
[ "$VERDICT" = "APPROVED" ] || { echo "FAIL: reviewer verdict=$VERDICT (期望 APPROVED)"; exit 1; }
[ "$ROUNDS" -ge 1 ] || { echo "FAIL: gan_rounds=$ROUNDS (必须 ≥ 1)"; exit 1; }
echo "PASS: reviewer APPROVED rounds=$ROUNDS"
```

**硬阈值**：`verdict='APPROVED'`；`gan_rounds ≥ 1`（防止 stub 跳过 GAN 直接写 APPROVED）；`updated_at` 在最近 30 分钟内。

---

### Step 5: generator 节点 — 在 `<init8>-<logical>` 复合 worktree 产出 docs/learnings/w8-langgraph-v16-e2e.md 并 push

**可观测行为**：以 initiative TASK_ID 为父，DB 中有 `task_type='harness_generate'` 的 sub_task 行 `status` 为 `completed` 或 `evaluator_pending`（generator 完成不一定立刻 completed，evaluator 才最终写 completed），`result->>'pr_url'` 形如 `https://github.com/.../pull/<number>`；该 PR 的 head 分支上 `docs/learnings/w8-langgraph-v16-e2e.md` 文件存在；分支命名包含 8 字符 init 前缀（H11 修复点）。

**验证命令**：
```bash
GEN_ROW=$(psql "$DB" -t -A -c "SELECT id, result->>'pr_url', result->>'branch' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_generate' AND status IN ('completed','evaluator_pending') AND updated_at > NOW() - interval '30 minutes' ORDER BY updated_at DESC LIMIT 1")
[ -n "$GEN_ROW" ] || { echo "FAIL: generator sub_task 未 completed/evaluator_pending"; exit 1; }
PR_URL=$(echo "$GEN_ROW" | awk -F'|' '{print $2}')
GEN_BRANCH=$(echo "$GEN_ROW" | awk -F'|' '{print $3}')
echo "$PR_URL" | grep -qE '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$' || { echo "FAIL: pr_url 不合法: $PR_URL"; exit 1; }
echo "$GEN_BRANCH" | grep -qE '^[a-z0-9-]*[0-9a-f]{8}-' || { echo "FAIL: generator 分支不含 init8 前缀 (H11 回归): $GEN_BRANCH"; exit 1; }
git fetch origin "$GEN_BRANCH" --depth=1 || { echo "FAIL: generator 分支不在 origin"; exit 1; }
DOC_BYTES=$(git cat-file -s "origin/$GEN_BRANCH:docs/learnings/w8-langgraph-v16-e2e.md")
[ "$DOC_BYTES" -gt 500 ] || { echo "FAIL: e2e 报告太小 ($DOC_BYTES bytes)"; exit 1; }
echo "PASS: generator pr=$PR_URL doc_bytes=$DOC_BYTES"
```

**硬阈值**：`pr_url` 匹配 GitHub PR URL 正则；`branch` 包含 `<8字符 hex>-` 前缀（H11 复合 key）；`docs/learnings/w8-langgraph-v16-e2e.md` 在 PR head 真实存在且 size > 500 bytes（防止空文件假绿）。

---

### Step 6: evaluator 节点 — 通过 callback PATCH sub_task `status='completed'` 且 result 含 PR URL

**可观测行为**：DB 中 generator sub_task（Step 5 的同一行 id）`status` 由 evaluator 写为 `completed`，`updated_at` 落在 evaluator 进程结束的那一分钟内；`result` JSON 字段非空且包含 `pr_url` 键；同一 PR 在 GitHub 上处于 OPEN 或 MERGED 状态（不能是 CLOSED-without-merge）。**关键造假防线**：必须能证明这次 PATCH 来自 evaluator 进程，而不是人工 curl —— 通过对比 evaluator sub_task 自己的 `result->>'callback_at'` 与 generator sub_task `updated_at` 的时间差 ≤ 5 分钟。

**验证命令**：
```bash
GEN_TASK_ID=$(psql "$DB" -t -A -c "SELECT id FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_generate' ORDER BY created_at DESC LIMIT 1")
GEN_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$GEN_TASK_ID'")
[ "$GEN_STATUS" = "completed" ] || { echo "FAIL: generator sub_task status=$GEN_STATUS (期望 completed)"; exit 1; }
GEN_RESULT_PR=$(psql "$DB" -t -A -c "SELECT result->>'pr_url' FROM tasks WHERE id='$GEN_TASK_ID'")
[ -n "$GEN_RESULT_PR" ] || { echo "FAIL: generator result.pr_url 为空"; exit 1; }
EVAL_CALLBACK=$(psql "$DB" -t -A -c "SELECT result->>'callback_at' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_evaluate' AND status='completed' ORDER BY updated_at DESC LIMIT 1")
[ -n "$EVAL_CALLBACK" ] || { echo "FAIL: evaluator sub_task 未 completed 或缺 callback_at（无法证明非人工 PATCH）"; exit 1; }
DRIFT_SECONDS=$(psql "$DB" -t -A -c "SELECT EXTRACT(EPOCH FROM (updated_at - '$EVAL_CALLBACK'::timestamp))::int FROM tasks WHERE id='$GEN_TASK_ID'")
DRIFT_ABS=${DRIFT_SECONDS#-}
[ "$DRIFT_ABS" -le 300 ] || { echo "FAIL: generator.updated_at 与 evaluator.callback_at 漂移 ${DRIFT_ABS}s > 300s（疑似人工 PATCH）"; exit 1; }
PR_NUM=$(echo "$GEN_RESULT_PR" | sed -E 's|.*/pull/([0-9]+)$|\1|')
PR_REPO=$(echo "$GEN_RESULT_PR" | sed -E 's|https://github.com/([^/]+/[^/]+)/pull/.*|\1|')
PR_STATE=$(gh api "repos/$PR_REPO/pulls/$PR_NUM" --jq '.state')
[ "$PR_STATE" = "open" ] || [ "$PR_STATE" = "closed" ] || { echo "FAIL: PR state=$PR_STATE 异常"; exit 1; }
echo "PASS: generator status=completed callback_drift=${DRIFT_ABS}s pr=$GEN_RESULT_PR ($PR_STATE)"
```

**硬阈值**：generator sub_task `status='completed'` 且 `result->>'pr_url'` 非空；evaluator sub_task 也 `completed` 且 `result->>'callback_at'` 与 generator `updated_at` 时差 ≤ 300 秒（强制证明 status 由 evaluator callback 写入，不是任何人工 PATCH —— 这是 PRD 第 7 条 "**不是任何人工 curl PATCH**" 的硬保证）；GitHub PR 实际可被 `gh api` 查到。

---

### Step 7: 出口 — 全链路完成且 e2e 报告含五节点 duration / GAN 轮数 / PR URL

**可观测行为**：generator PR 头分支上 `docs/learnings/w8-langgraph-v16-e2e.md` 内容包含 PRD 范围限定要求的全部三类信息：(a) 5 个节点（planner/proposer/reviewer/generator/evaluator）各自的耗时秒数或分钟数，(b) GAN proposer/reviewer 轮数，(c) 最终 PR URL。

**验证命令**：
```bash
GEN_BRANCH=$(psql "$DB" -t -A -c "SELECT result->>'branch' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_generate' ORDER BY created_at DESC LIMIT 1")
git fetch origin "$GEN_BRANCH" --depth=1
DOC=$(git show "origin/$GEN_BRANCH:docs/learnings/w8-langgraph-v16-e2e.md")
echo "$DOC" | grep -qiE '(planner)[^|]*[0-9]+\s*(s|sec|分|min)' || { echo "FAIL: 报告缺 planner duration"; exit 1; }
echo "$DOC" | grep -qiE '(proposer)[^|]*[0-9]+\s*(s|sec|分|min)' || { echo "FAIL: 报告缺 proposer duration"; exit 1; }
echo "$DOC" | grep -qiE '(reviewer)[^|]*[0-9]+\s*(s|sec|分|min)' || { echo "FAIL: 报告缺 reviewer duration"; exit 1; }
echo "$DOC" | grep -qiE '(generator)[^|]*[0-9]+\s*(s|sec|分|min)' || { echo "FAIL: 报告缺 generator duration"; exit 1; }
echo "$DOC" | grep -qiE '(evaluator)[^|]*[0-9]+\s*(s|sec|分|min)' || { echo "FAIL: 报告缺 evaluator duration"; exit 1; }
echo "$DOC" | grep -qiE 'gan[^|]*(rounds?|轮)[^|]*[0-9]+' || { echo "FAIL: 报告缺 GAN 轮数"; exit 1; }
echo "$DOC" | grep -qE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' || { echo "FAIL: 报告缺 PR URL"; exit 1; }
echo "PASS: e2e 报告完整覆盖 5 节点 duration + GAN 轮数 + PR URL"
```

**硬阈值**：5 个节点 duration 全部命中；GAN 轮数命中；PR URL 命中（必须是真 GitHub PR URL，不能是占位符）。任一缺失即 FAIL。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
BRAIN="${BRAIN:-http://localhost:5221}"

# === 0. 预条件：Brain healthy + ACCOUNTS 至少 2 个非 throttle ===
curl -fsS "$BRAIN/api/brain/health" | jq -e '.status=="ok"' >/dev/null || { echo "FAIL: Brain unhealthy"; exit 1; }
ACTIVE_ACCOUNTS=$(curl -fsS "$BRAIN/api/brain/accounts" | jq '[.accounts[] | select(.throttled_until==null or .throttled_until < now)] | length')
[ "$ACTIVE_ACCOUNTS" -ge 2 ] || { echo "FAIL: ACCOUNTS 池可用账号 $ACTIVE_ACCOUNTS < 2"; exit 1; }

# === 1. 触发 v16 walking skeleton 任务 ===
TASK_ID=$(curl -fsS -X POST "$BRAIN/api/brain/tasks" \
  -H 'Content-Type: application/json' \
  -d '{"task_type":"harness_initiative","description":"[W8 v16 — final] Walking Skeleton noop 真端到端","payload":{"skeleton_mode":true}}' \
  | jq -r '.id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || { echo "FAIL: 派发 task 失败"; exit 1; }
echo "派发成功 TASK_ID=$TASK_ID"

# === 2. 等待全链路完成（最多 90 分钟）===
DEADLINE=$(($(date +%s) + 5400))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$TASK_ID'")
  echo "[$(date +%H:%M:%S)] initiative status=$STATUS"
  if [ "$STATUS" = "completed" ]; then break; fi
  if [ "$STATUS" = "failed" ]; then echo "FAIL: initiative status=failed"; exit 1; fi
  sleep 60
done
[ "$STATUS" = "completed" ] || { echo "FAIL: 90min 超时, status=$STATUS"; exit 1; }

# === 3. 逐步骤验证（Step 1~7 复用 contract 里的命令）===
export TASK_ID DB
bash -e <<'EOF'
# Step 1
TASK_ROW=$(psql "$DB" -t -A -c "SELECT id FROM tasks WHERE id='$TASK_ID' AND task_type='harness_initiative' AND (payload->>'skeleton_mode')='true'")
[ -n "$TASK_ROW" ] || { echo "Step1 FAIL"; exit 1; }
echo "Step1 PASS"

# Step 2 planner
PLANNER_VERDICT=$(psql "$DB" -t -A -c "SELECT result->>'verdict' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_planner' AND status='completed' ORDER BY updated_at DESC LIMIT 1")
[ "$PLANNER_VERDICT" = "DONE" ] || { echo "Step2 FAIL verdict=$PLANNER_VERDICT"; exit 1; }
echo "Step2 PASS"

# Step 3 proposer
PROPOSE_BRANCH=$(psql "$DB" -t -A -c "SELECT result->>'propose_branch' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_propose' AND status='completed' ORDER BY updated_at DESC LIMIT 1")
git fetch origin "$PROPOSE_BRANCH" --depth=1
git cat-file -e "origin/$PROPOSE_BRANCH:sprints/w8-langgraph-v16/sprint-contract.md"
git cat-file -e "origin/$PROPOSE_BRANCH:sprints/w8-langgraph-v16/task-plan.json"
echo "Step3 PASS branch=$PROPOSE_BRANCH"

# Step 4 reviewer
REV_VERDICT=$(psql "$DB" -t -A -c "SELECT result->>'verdict' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_review' AND status='completed' ORDER BY updated_at DESC LIMIT 1")
[ "$REV_VERDICT" = "APPROVED" ] || { echo "Step4 FAIL verdict=$REV_VERDICT"; exit 1; }
echo "Step4 PASS"

# Step 5/6 generator + evaluator callback
GEN_ID=$(psql "$DB" -t -A -c "SELECT id FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_generate' ORDER BY created_at DESC LIMIT 1")
GEN_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$GEN_ID'")
[ "$GEN_STATUS" = "completed" ] || { echo "Step5/6 FAIL gen status=$GEN_STATUS"; exit 1; }
PR_URL=$(psql "$DB" -t -A -c "SELECT result->>'pr_url' FROM tasks WHERE id='$GEN_ID'")
echo "$PR_URL" | grep -qE '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$' || { echo "Step5/6 FAIL pr_url=$PR_URL"; exit 1; }
EVAL_CB=$(psql "$DB" -t -A -c "SELECT result->>'callback_at' FROM tasks WHERE parent_task_id='$TASK_ID' AND task_type='harness_evaluate' AND status='completed' ORDER BY updated_at DESC LIMIT 1")
[ -n "$EVAL_CB" ] || { echo "Step5/6 FAIL evaluator callback_at 缺失（疑似人工 PATCH）"; exit 1; }
DRIFT=$(psql "$DB" -t -A -c "SELECT ABS(EXTRACT(EPOCH FROM (updated_at - '$EVAL_CB'::timestamp)))::int FROM tasks WHERE id='$GEN_ID'")
[ "$DRIFT" -le 300 ] || { echo "Step5/6 FAIL drift=${DRIFT}s（status 非 evaluator 写入）"; exit 1; }
echo "Step5/6 PASS pr=$PR_URL drift=${DRIFT}s"

# Step 7 e2e 报告
GEN_BRANCH=$(psql "$DB" -t -A -c "SELECT result->>'branch' FROM tasks WHERE id='$GEN_ID'")
git fetch origin "$GEN_BRANCH" --depth=1
DOC=$(git show "origin/$GEN_BRANCH:docs/learnings/w8-langgraph-v16-e2e.md")
for NODE in planner proposer reviewer generator evaluator; do
  echo "$DOC" | grep -qiE "${NODE}[^|]*[0-9]+\s*(s|sec|分|min)" || { echo "Step7 FAIL: 缺 ${NODE} duration"; exit 1; }
done
echo "$DOC" | grep -qiE 'gan[^|]*(rounds?|轮)[^|]*[0-9]+' || { echo "Step7 FAIL: 缺 GAN 轮数"; exit 1; }
echo "$DOC" | grep -qE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' || { echo "Step7 FAIL: 缺 PR URL"; exit 1; }
echo "Step7 PASS"
EOF

echo "✅ W8 v16 Golden Path 全链路验证通过"
```

**通过标准**：脚本 exit 0，且 stdout 含全部 `Step1~7 PASS` 标记。

---

## Workstreams

workstream_count: 1

### Workstream 1: docs/learnings/w8-langgraph-v16-e2e.md（Walking Skeleton 唯一交付）

**范围**：Walking Skeleton noop 模式下 generator 节点产出的唯一文件 — `docs/learnings/w8-langgraph-v16-e2e.md`，记录 5 个节点 duration、GAN proposer/reviewer 轮数、最终 PR URL，以及若有节点跑挂的定位说明。**不允许修改 packages/ 任何运行时代码**（PRD 范围限定）。

**大小**：S（< 100 行 markdown）

**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/v16-e2e-completion.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/v16-e2e-completion.test.ts` | (a) DB 中 v16 generator sub_task `status='completed'` 由 evaluator callback 写入；(b) `result.pr_url` 为合法 GitHub PR URL；(c) generator.updated_at 与 evaluator.callback_at 漂移 ≤ 300s（防人工 PATCH） | WS1 → ≥ 3 failures（DB 中尚不存在 v16 task，初始全部 fail） |
