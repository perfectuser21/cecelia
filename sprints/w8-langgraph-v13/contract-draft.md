# Sprint Contract Draft (Round 1)

## Golden Path

[创建 harness_initiative 任务] → [Layer 1 Planner SKILL] → [Layer 2 Proposer/Reviewer GAN] → [Layer 3 spawn-and-interrupt + Generator] → [Evaluator] → [Absorption] → [Complete] → [evidence 落盘 + result.md 写 PASS / H12 草案]

---

### Step 1: 触发 — POST /api/brain/tasks 创建一条最简 harness_initiative

**可观测行为**: Brain API 接受请求并返回新创建的 task 行（含 id、status=queued 或 in_progress、task_type=harness_initiative）。

**验证命令**:
```bash
RESP=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d '{"task_type":"harness_initiative","payload":{"description":"W8 v13 真端到端验证最简 Initiative：往 docs/current/README.md 顶部追加一行 W8 v13 verification stamp YYYY-MM-DD","tags":["verification","w8-v13"]}}')
INITIATIVE_TASK_ID=$(echo "$RESP" | jq -r '.id // .task_id')
echo "$INITIATIVE_TASK_ID" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 1
# 期望：返回的 id 是合法 UUID v4 格式
```

**硬阈值**: HTTP 200，response.id 是合法 UUID，且耗时 < 3s。

---

### Step 2: Layer 1 — harness-planner SKILL 跑通且无 push noise（H9 验证点）

**可观测行为**: Initiative 任务被分发后，brain 容器日志里出现 planner SKILL 调用并最终输出 verdict=DONE；同时 stderr 不含 "fatal: could not read Username" 或 "remote: Permission denied" 之类 push noise。

**验证命令**:
```bash
# 等待 planner 节点至多 5 分钟
timeout 300 bash -c "until docker logs cecelia-brain 2>&1 | grep -q '\"verdict\":\"DONE\".*'\"$INITIATIVE_TASK_ID\"; do sleep 5; done"

# 抓 planner 阶段最近 5 分钟日志，断言无 push fatal
PLANNER_LOG=$(docker logs --since 5m cecelia-brain 2>&1 | grep -F "$INITIATIVE_TASK_ID" | grep -E "planner|harness-planner")
echo "$PLANNER_LOG" | grep -E 'fatal: could not read|Permission denied|push.*denied' && exit 1
echo "$PLANNER_LOG" | grep -q '"verdict":"DONE"' || exit 1
# 期望：含 verdict=DONE，不含 push fatal
```

**硬阈值**: planner 在 5 分钟内出 DONE 且日志无 push 错误关键字。

---

### Step 3: Layer 2 — Proposer/Reviewer GAN 收敛 APPROVED

**可观测行为**: brain.tasks 表里出现该 initiative 子树的 harness_contract_propose / harness_contract_review 任务，且最终 review 任务的 result 含 `"verdict":"APPROVED"`，未触发 MAX_ROUNDS 强制路径。同时 sprints/<initiative-sprint-dir>/sprint-contract.md 与 task-plan.json 都已生成在 propose 分支上。

**验证命令**:
```bash
# 找出所有挂在该 initiative 下的 review 任务
APPROVED_COUNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='harness_contract_review' AND status='completed' AND result::text LIKE '%\"verdict\":\"APPROVED\"%' AND created_at > NOW() - interval '30 minutes'")
[ "$APPROVED_COUNT" -ge 1 ] || exit 1

# 断言不是 MAX_ROUNDS 强收敛
MAX_ROUNDS_HIT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='harness_contract_review' AND result::text LIKE '%MAX_ROUNDS%'")
[ "$MAX_ROUNDS_HIT" -eq 0 ] || exit 1

# 断言 contract 与 task-plan 在 propose 分支上有内容
PROPOSE_BRANCH=$(psql "$DB_URL" -tAc "SELECT result->>'propose_branch' FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='harness_contract_propose' AND status='completed' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
git fetch origin "$PROPOSE_BRANCH" 2>&1 | grep -v '^From '
git show "origin/$PROPOSE_BRANCH:sprints/" 2>/dev/null | head -3 || true
git ls-tree -r "origin/$PROPOSE_BRANCH" | grep -E 'sprint-contract\.md|task-plan\.json' | wc -l | grep -qE '^\s*[2-9]' || exit 1
# 期望：APPROVED ≥ 1，无 MAX_ROUNDS，propose 分支上至少 sprint-contract.md + task-plan.json 两个文件
```

**硬阈值**: APPROVED 任务 ≥ 1，MAX_ROUNDS 命中 = 0，propose 分支含 contract + plan。

---

### Step 4: Layer 3 — spawn-and-interrupt 模式正确（#2851 验证点）

**可观测行为**: brain 在分发 sub_task 时为每个子任务注入 `logical_task_id` 字段；每个 sub_task 在自己独立的 git worktree 里执行（worktree path 含 `sub_task` UUID 前缀），不与 initiative 主目录共享。

**验证命令**:
```bash
# 子任务都带 logical_task_id
SUBTASKS_WITHOUT_LOGICAL=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID') AND payload->>'logical_task_id' IS NULL AND created_at > NOW() - interval '30 minutes'")
[ "$SUBTASKS_WITHOUT_LOGICAL" -eq 0 ] || exit 1

# 子任务 worktree 路径不与 initiative 根目录相等
INIT_WT=$(psql "$DB_URL" -tAc "SELECT result->>'worktree_path' FROM tasks WHERE id='$INITIATIVE_TASK_ID'" | tr -d ' ')
SHARED_COUNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID') AND task_type='generator' AND result->>'worktree_path' = '$INIT_WT'")
[ "$SHARED_COUNT" -eq 0 ] || exit 1
# 期望：所有 sub_task 都有 logical_task_id；没有任何 generator 子任务跟 initiative 共享 worktree
```

**硬阈值**: 缺 logical_task_id 的子任务数 = 0，与 initiative 共享 worktree 的 generator 子任务数 = 0。

---

### Step 5: Generator 远端 agent stdout tee 非空（H7 验证点）

**可观测行为**: 至少一个 generator 类型子任务 result.stdout 字段长度 > 0（说明 entrypoint.sh tee 生效且回调拿到内容）。

**验证命令**:
```bash
NONEMPTY_STDOUT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID') AND task_type='generator' AND status IN ('completed','failed') AND length(coalesce(result->>'stdout','')) > 100 AND created_at > NOW() - interval '30 minutes'")
[ "$NONEMPTY_STDOUT" -ge 1 ] || exit 1
# 期望：至少 1 条 generator 子任务的 stdout 长度 > 100 字节
```

**硬阈值**: stdout > 100 字节的 generator 子任务 ≥ 1。

---

### Step 6: Evaluator 在 Generator 的 task worktree 上运行（H8 验证点）

**可观测行为**: 每个 evaluator 子任务的 result.evaluator_worktree_path 字段等于其姊妹 generator 子任务的 result.worktree_path（同一 logical_task_id 下）。

**验证命令**:
```bash
MISMATCH=$(psql "$DB_URL" -tAc "
WITH paired AS (
  SELECT
    e.id AS eval_id,
    e.result->>'evaluator_worktree_path' AS eval_wt,
    g.result->>'worktree_path' AS gen_wt
  FROM tasks e
  JOIN tasks g
    ON g.payload->>'logical_task_id' = e.payload->>'logical_task_id'
   AND g.task_type='generator'
  WHERE e.task_type='evaluator'
    AND e.parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID')
    AND e.created_at > NOW() - interval '30 minutes'
)
SELECT count(*) FROM paired WHERE eval_wt IS DISTINCT FROM gen_wt
")
[ "$MISMATCH" -eq 0 ] || exit 1
# 期望：所有 evaluator/generator 配对的 worktree path 一致
```

**硬阈值**: worktree 不一致的 evaluator 数 = 0。

---

### Step 7: Absorption policy 真实触发（#2855 验证点）

**可观测行为**: 该 initiative 的 absorption 子任务 result 字段必须含 `applied` 布尔字段；若 applied=true 必含 `pr_url`；若 applied=false 必含非空 `reason` 字段。绝不允许出现"假装 applied"的空字段路径。

**验证命令**:
```bash
ABS_RESULT=$(psql "$DB_URL" -tAc "SELECT result::text FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='absorption' AND status='completed' AND created_at > NOW() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1")
[ -n "$ABS_RESULT" ] || exit 1

APPLIED=$(echo "$ABS_RESULT" | jq -r '.applied')
case "$APPLIED" in
  true)
    PR_URL=$(echo "$ABS_RESULT" | jq -r '.pr_url')
    [ -n "$PR_URL" ] && [ "$PR_URL" != "null" ] || exit 1
    ;;
  false)
    REASON=$(echo "$ABS_RESULT" | jq -r '.reason')
    [ -n "$REASON" ] && [ "$REASON" != "null" ] || exit 1
    ;;
  *)
    exit 1
    ;;
esac
# 期望：applied 是布尔；true 时 pr_url 非空；false 时 reason 非空
```

**硬阈值**: 上述 case 必须命中 true 或 false 分支之一，且对应字段非空。

---

### Step 8: 终态 — initiative 任务 status=completed + evidence 落盘 + result.md 写裁决

**可观测行为**: brain.tasks 中 initiative 行 status=completed；sprints/w8-langgraph-v13/evidence/ 含三件证据（trace.txt、db-snapshot.json、pr-link.txt）；sprints/w8-langgraph-v13/result.md 第一行明确写 PASS 或 FAIL，FAIL 时同时生成 sprints/w8-langgraph-v13/h12-draft.md。

**验证命令**:
```bash
# initiative 终态
STATUS=$(curl -fsS "localhost:5221/api/brain/tasks/$INITIATIVE_TASK_ID" | jq -r '.status')
[ "$STATUS" = "completed" ] || exit 1

# evidence 三件齐
for f in trace.txt db-snapshot.json pr-link.txt; do
  [ -s "sprints/w8-langgraph-v13/evidence/$f" ] || exit 1
done

# checkpoint 终节点是 complete/end，不是 interrupted/error
FINAL_NODE=$(psql "$DB_URL" -tAc "SELECT metadata->>'next_node' FROM langgraph_checkpoints WHERE thread_id='$INITIATIVE_TASK_ID' ORDER BY checkpoint_id DESC LIMIT 1")
echo "$FINAL_NODE" | grep -qE '^(complete|end|__end__)$' || exit 1

# result.md 第一行有 PASS 或 FAIL
head -1 sprints/w8-langgraph-v13/result.md | grep -qE '^(PASS|FAIL)' || exit 1

# 若 FAIL，h12-draft.md 必须生成
if head -1 sprints/w8-langgraph-v13/result.md | grep -q '^FAIL'; then
  [ -s sprints/w8-langgraph-v13/h12-draft.md ] || exit 1
fi
# 期望：所有断言通过
```

**硬阈值**: status=completed，evidence 三件齐且非空，checkpoint 终节点合法，result.md 有 PASS/FAIL 裁决，FAIL 时含 H12 草案。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: agent_remote

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/w8-langgraph-v13"
EVIDENCE_DIR="$SPRINT_DIR/evidence"
mkdir -p "$EVIDENCE_DIR"

# === Step 1: 触发 ===
RESP=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d "{\"task_type\":\"harness_initiative\",\"payload\":{\"description\":\"W8 v13 真端到端验证最简 Initiative：往 docs/current/README.md 顶部追加一行 W8 v13 verification stamp $(date -u +%Y-%m-%d)\",\"tags\":[\"verification\",\"w8-v13\"]}}")
INITIATIVE_TASK_ID=$(echo "$RESP" | jq -r '.id // .task_id')
[[ "$INITIATIVE_TASK_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "Step1 FAIL: bad task id"; exit 1; }
echo "INITIATIVE_TASK_ID=$INITIATIVE_TASK_ID"

# === 调脚本 collect-evidence.sh：触发后等待 + 抽 trace/db/pr ===
bash "$SPRINT_DIR/scripts/collect-evidence.sh" "$INITIATIVE_TASK_ID" "$EVIDENCE_DIR" || { echo "collect-evidence FAIL"; exit 1; }

# === Step 2~7 直接基于 evidence + DB 校验 ===
# Step 2: planner DONE 且无 push noise
docker logs --since 60m cecelia-brain 2>&1 | grep -F "$INITIATIVE_TASK_ID" | grep -E "planner|harness-planner" > /tmp/planner.log || true
grep -E 'fatal: could not read|Permission denied|push.*denied' /tmp/planner.log && { echo "Step2 FAIL: push noise"; exit 1; } || true
grep -q '"verdict":"DONE"' /tmp/planner.log || { echo "Step2 FAIL: no DONE"; exit 1; }

# Step 3: GAN APPROVED 且无 MAX_ROUNDS
APPROVED_COUNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='harness_contract_review' AND status='completed' AND result::text LIKE '%\"verdict\":\"APPROVED\"%'")
[ "$APPROVED_COUNT" -ge 1 ] || { echo "Step3 FAIL: no APPROVED"; exit 1; }
MAX_ROUNDS_HIT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='harness_contract_review' AND result::text LIKE '%MAX_ROUNDS%'")
[ "$MAX_ROUNDS_HIT" -eq 0 ] || { echo "Step3 FAIL: MAX_ROUNDS hit"; exit 1; }

# Step 4: logical_task_id 注入 + worktree 隔离
SUBTASKS_WITHOUT_LOGICAL=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID') AND payload->>'logical_task_id' IS NULL")
[ "$SUBTASKS_WITHOUT_LOGICAL" -eq 0 ] || { echo "Step4 FAIL: missing logical_task_id"; exit 1; }

# Step 5: generator stdout 非空
NONEMPTY=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID') AND task_type='generator' AND length(coalesce(result->>'stdout','')) > 100")
[ "$NONEMPTY" -ge 1 ] || { echo "Step5 FAIL: empty stdout"; exit 1; }

# Step 6: evaluator worktree 一致
MISMATCH=$(psql "$DB_URL" -tAc "
WITH paired AS (
  SELECT e.result->>'evaluator_worktree_path' AS eval_wt, g.result->>'worktree_path' AS gen_wt
  FROM tasks e JOIN tasks g
    ON g.payload->>'logical_task_id' = e.payload->>'logical_task_id' AND g.task_type='generator'
  WHERE e.task_type='evaluator'
    AND e.parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID')
)
SELECT count(*) FROM paired WHERE eval_wt IS DISTINCT FROM gen_wt
")
[ "$MISMATCH" -eq 0 ] || { echo "Step6 FAIL: eval worktree mismatch"; exit 1; }

# Step 7: absorption 诚实
ABS_JSON=$(psql "$DB_URL" -tAc "SELECT result::text FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='absorption' AND status='completed' ORDER BY created_at DESC LIMIT 1")
APPLIED=$(echo "$ABS_JSON" | jq -r '.applied')
if [ "$APPLIED" = "true" ]; then
  PR_URL=$(echo "$ABS_JSON" | jq -r '.pr_url'); [ -n "$PR_URL" ] && [ "$PR_URL" != "null" ] || { echo "Step7 FAIL: applied=true but no pr_url"; exit 1; }
elif [ "$APPLIED" = "false" ]; then
  REASON=$(echo "$ABS_JSON" | jq -r '.reason'); [ -n "$REASON" ] && [ "$REASON" != "null" ] || { echo "Step7 FAIL: applied=false but no reason"; exit 1; }
else
  echo "Step7 FAIL: absorption.applied not boolean"; exit 1
fi

# === Step 8: 终态 + judge ===
STATUS=$(curl -fsS "localhost:5221/api/brain/tasks/$INITIATIVE_TASK_ID" | jq -r '.status')
[ "$STATUS" = "completed" ] || { echo "Step8 FAIL: status=$STATUS"; exit 1; }

bash "$SPRINT_DIR/scripts/judge-result.sh" "$INITIATIVE_TASK_ID" "$EVIDENCE_DIR" "$SPRINT_DIR" || { echo "judge-result FAIL"; exit 1; }

head -1 "$SPRINT_DIR/result.md" | grep -qE '^(PASS|FAIL)' || { echo "Step8 FAIL: result.md missing verdict"; exit 1; }
if head -1 "$SPRINT_DIR/result.md" | grep -q '^FAIL'; then
  [ -s "$SPRINT_DIR/h12-draft.md" ] || { echo "Step8 FAIL: FAIL but no h12-draft.md"; exit 1; }
fi

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0；result.md 第一行为 PASS（FAIL 也被视为"验证机制本身工作正常"，但本 sprint 的 OKR 进度只有 PASS 时才算结清；FAIL 自动派生 H12+ initiative 由后继 sprint 接力）。

---

## Workstreams

workstream_count: 2

### Workstream 1: collect-evidence 脚本（M）

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/collect-evidence.sh`，签名 `collect-evidence.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR>`。
- 轮询 brain API，等待 initiative status ∈ {completed, failed} 或超时（默认 60min，可通过 `TIMEOUT_SEC` env 覆盖）
- 把 brain 容器最近 60 分钟内含 `<INITIATIVE_TASK_ID>` 的日志写入 `<EVIDENCE_DIR>/trace.txt`，并按 7 节点签名（plan/propose/review/spawn/generator/evaluator/absorption）抽出最少 1 行/节点
- 把 `tasks` + `langgraph_checkpoints` 中与 initiative 相关的行写入 `<EVIDENCE_DIR>/db-snapshot.json`
- 从 absorption 任务 result 抽 PR URL（或 NO_CHANGE 说明）写入 `<EVIDENCE_DIR>/pr-link.txt`
- 支持 `DRY_RUN=1` 时只打印执行计划且 exit 0，不真实调 brain
- 不带参数时 exit 1 并输出 usage 到 stderr

**大小**: M（150~250 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts`

---

### Workstream 2: judge-result 脚本 + result.md 生成器（S）

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/judge-result.sh`，签名 `judge-result.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR> <SPRINT_DIR>`。
- 读取 evidence 三件，按 Step 2~7 的硬阈值逐项判定
- 全部通过 → 写 `<SPRINT_DIR>/result.md` 第一行 `PASS — W8 v13 端到端验证通过`，附通过的 7 个节点摘要
- 任一失败 → 写 `<SPRINT_DIR>/result.md` 第一行 `FAIL — 卡在 <step_n>`，并生成 `<SPRINT_DIR>/h12-draft.md`（含失败 step、失败假设、修复方向草稿）
- 同时写 `<SPRINT_DIR>/result.md` 必含字段：`Initiative Task ID:`、`Verdict:`、`Failed Step:`（FAIL 时）、`PR/NO_CHANGE:`

**大小**: S（80~150 行）
**依赖**: Workstream 1 完成（消费其 evidence 输出）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts` | 脚本存在/可执行；DRY_RUN=1 输出含 trace/db/pr 三个产出物名；缺参 exit 1 + usage 到 stderr | WS1 → 4 failures（脚本不存在导致 child_process spawn 失败） |
| WS2 | `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts` | 给定 fixture-pass 证据写 result.md 含 `^PASS`；给定 fixture-fail 证据写 result.md 含 `^FAIL` 并生成 h12-draft.md；缺参 exit 1 | WS2 → 3 failures |
