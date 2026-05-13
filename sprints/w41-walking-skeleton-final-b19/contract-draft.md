# Sprint Contract Draft (Round 1)

> **journey_type**: autonomous（Brain 内部 task graph 端到端验证，无 HTTP/UI/远端 agent 协议改动）
> **本质**：本 sprint 是**验证 sprint**——B14–B19 的 6 个 fix 已 merge，但缺一次"端到端真跑"证 fix 协同生效。Generator 不改 Brain 源码，只造演练 W 任务、驱 harness-task graph 跑完、收原始证据、写报告。

---

## Golden Path

[Generator 注入演练 W 任务到 Brain] →
[Brain dispatcher 选中 → harness-task graph：spawn(generator) → parse(pr_url) → poll(ci) → evaluate_contract 第 1 轮（演练 task 故意 FAIL）] →
[routeAfterEvaluate FAIL → fixDispatchNode（B19：state.pr_url+pr_branch **保留** 不 reset）] →
[第 2 轮 spawn(generator fix mode) 同 PR push → poll(ci pass) → evaluate_contract 第 2 轮（PASS）] →
[evaluate_contract 第 2 轮 spawn 时 env.PR_BRANCH **非空**且**等于第 1 轮的 pr_branch**（B14+B19 协同证据）] →
[evaluator 容器内 `git rev-parse HEAD` 等于 `origin/<PR_BRANCH>` 而 **不等于** origin/main（证 evaluator 真在 PR 分支跑）] →
[routeAfterEvaluate PASS → merge_pr → tasks.status='completed' + dev_records.merged_at 非空 + dev_records.pr_url 等于第 1 轮观察到的 pr_url（证 fix 循环全程 pr_url 未漂）] →
[Generator 收集 5 类证据写 verification-report.md，含可点 PR 链接 + 引用的日志/DB 行]

---

### Step 1: 演练 W 任务被注入到 Brain

**可观测行为**: 一个新的 task 行写入 `tasks` 表，task_type='harness_*'，status='queued'，payload 含可触发 harness-task graph 的 sprint_dir 字段；同时 `sprints/w41-walking-skeleton-final-b19/seed-output.json` 记录该 task 的 UUID 和注入时间戳。

**验证命令**:
```bash
SEED_OUT="sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json"
[ -s "$SEED_OUT" ] || { echo "FAIL: seed-output.json 缺失或空"; exit 1; }
DEMO_TASK_ID=$(jq -er '.demo_task_id' "$SEED_OUT")
DEMO_INJECTED_AT=$(jq -er '.injected_at' "$SEED_OUT")
[ -n "$DEMO_TASK_ID" ] && [ -n "$DEMO_INJECTED_AT" ] || { echo "FAIL: seed-output.json 字段缺失"; exit 1; }
DB="${DB:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='$DEMO_TASK_ID' AND task_type LIKE 'harness_%' AND created_at > NOW() - interval '24 hours'")
[ "$COUNT" = "1" ] || { echo "FAIL: tasks 表无对应行（DEMO_TASK_ID=$DEMO_TASK_ID）"; exit 1; }
echo "PASS: 演练 task 已注入 (id=$DEMO_TASK_ID)"
```

**硬阈值**: count=1，injected_at 在过去 24 小时内（防 replay 旧 task 假装跑过），demo_task_id 是合法 UUID v4 字面量。

---

### Step 2: harness-task graph 真走过 fix 循环（≥ 1 次）

**可观测行为**: dispatch_events 表内 task_id=$DEMO_TASK_ID 的子任务派发链中，event_type='dispatched' 且 reason 含 'harness_evaluate' 的记录 **≥ 2** 次（即第 1 轮 evaluate FAIL 后进 fix → 第 2 轮 evaluate；每次 evaluate 都是独立 dispatch）。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
DEMO_TASK_ID=$(jq -er '.demo_task_id' sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json)
EVAL_COUNT=$(psql "$DB" -tAc "
  SELECT count(*) FROM dispatch_events
  WHERE task_id IN (
    SELECT id FROM tasks WHERE payload->>'parent_task_id'='$DEMO_TASK_ID' OR id='$DEMO_TASK_ID'
  )
  AND event_type='dispatched'
  AND COALESCE(reason,'') ILIKE '%harness_evaluate%'
  AND created_at > NOW() - interval '24 hours'")
[ "$EVAL_COUNT" -ge 2 ] || { echo "FAIL: harness_evaluate dispatch 次数=$EVAL_COUNT 不足 2，证 fix 循环未触发"; exit 1; }
echo "PASS: fix 循环触发 evaluate $EVAL_COUNT 次"
```

**硬阈值**: EVAL_COUNT ≥ 2，全部在过去 24 小时内（防引用旧任务）。

---

### Step 3: fix 循环全程 pr_url + pr_branch 保留（B19 证据）

**可观测行为**: 收集到的 raw evidence 文件 `evidence/pr-url-trace.txt` 列出 fix 循环每一轮 evaluate_contract 节点拿到的 pr_url 和 pr_branch；所有行的 pr_url 完全相等（不为空、不变化），所有行的 pr_branch 完全相等。

**验证命令**:
```bash
TRACE="sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt"
[ -s "$TRACE" ] || { echo "FAIL: pr-url-trace.txt 缺失"; exit 1; }
# 文件每行格式：round=N pr_url=https://... pr_branch=cp-xxx
ROUNDS=$(wc -l < "$TRACE" | tr -d ' ')
[ "$ROUNDS" -ge 2 ] || { echo "FAIL: trace 仅 $ROUNDS 行，需 ≥ 2 证 fix 循环"; exit 1; }
UNIQUE_URLS=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print $i}' "$TRACE" | sort -u | wc -l | tr -d ' ')
UNIQUE_BRANCHES=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_branch=/)print $i}' "$TRACE" | sort -u | wc -l | tr -d ' ')
[ "$UNIQUE_URLS" = "1" ] || { echo "FAIL: pr_url 跨轮发生漂移（unique=$UNIQUE_URLS），B19 fix 失效"; exit 1; }
[ "$UNIQUE_BRANCHES" = "1" ] || { echo "FAIL: pr_branch 跨轮发生漂移（unique=$UNIQUE_BRANCHES），B19 fix 失效"; exit 1; }
EMPTY=$(grep -cE 'pr_url=$|pr_url=\b|pr_branch=$' "$TRACE" || true)
[ "$EMPTY" = "0" ] || { echo "FAIL: trace 中存在空 pr_url/pr_branch 行（$EMPTY 行），B19 fix 失效"; exit 1; }
echo "PASS: $ROUNDS 轮 fix 循环 pr_url + pr_branch 全程保留一致"
```

**硬阈值**: ROUNDS ≥ 2 且 UNIQUE_URLS=1 且 UNIQUE_BRANCHES=1 且 EMPTY=0。任一不满足 = B19 fix 未真正生效。

---

### Step 4: evaluator 真在 PR 分支上跑（不是 main）

**可观测行为**: `evidence/evaluator-checkout-proof.txt` 含两行：
- 第 1 行 `PR_BRANCH=<分支名>`（来自 evaluator container 启动时 env），分支名匹配 `^cp-.+` 或类似 PR 分支命名
- 第 2 行 `evaluator_HEAD=<sha>` 等于 `origin/<PR_BRANCH>` 当时的 HEAD（用 `git rev-parse origin/<PR_BRANCH>` 比对），且 **不等于** origin/main 的 HEAD

**验证命令**:
```bash
PROOF="sprints/w41-walking-skeleton-final-b19/evidence/evaluator-checkout-proof.txt"
[ -s "$PROOF" ] || { echo "FAIL: evaluator-checkout-proof.txt 缺失"; exit 1; }
PR_BRANCH=$(grep -E '^PR_BRANCH=' "$PROOF" | head -1 | cut -d= -f2)
HEAD_SHA=$(grep -E '^evaluator_HEAD=' "$PROOF" | head -1 | cut -d= -f2)
[ -n "$PR_BRANCH" ] && [ -n "$HEAD_SHA" ] || { echo "FAIL: 缺 PR_BRANCH 或 evaluator_HEAD 字段"; exit 1; }
[ "$PR_BRANCH" != "main" ] || { echo "FAIL: PR_BRANCH 字面值=main，evaluator 仍在 main 跑"; exit 1; }
git fetch origin "$PR_BRANCH" 2>/dev/null || true
EXPECTED=$(git rev-parse "origin/$PR_BRANCH" 2>/dev/null || echo NOTFOUND)
MAIN_HEAD=$(git rev-parse origin/main 2>/dev/null || echo NOTFOUND)
[ "$HEAD_SHA" = "$EXPECTED" ] || { echo "FAIL: evaluator_HEAD ($HEAD_SHA) ≠ origin/$PR_BRANCH ($EXPECTED)"; exit 1; }
[ "$HEAD_SHA" != "$MAIN_HEAD" ] || { echo "FAIL: evaluator_HEAD 等于 origin/main，未真切到 PR 分支"; exit 1; }
echo "PASS: evaluator 在 PR 分支 ($PR_BRANCH) HEAD=$HEAD_SHA 跑，与 main 不同"
```

**硬阈值**: PR_BRANCH ≠ "main"，HEAD_SHA = origin/PR_BRANCH 当前 HEAD，HEAD_SHA ≠ origin/main HEAD。

---

### Step 5: 端到端收敛 — task=completed + dev_records 写齐

**可观测行为**: `tasks` 表 demo_task_id 行 status='completed'，result 字段含 verdict 子字段；`dev_records` 表对应 task_id 行 pr_url 非空，merged_at 非空，且 pr_url 等于 Step 3 trace 中观察到的 pr_url（证 fix 循环全程 URL 一致直到 merge）。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
DEMO_TASK_ID=$(jq -er '.demo_task_id' sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json)
TRACE_URL=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print substr($i,8)}' \
  sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt | sort -u | head -1)

TASK_STATUS=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$DEMO_TASK_ID'")
[ "$TASK_STATUS" = "completed" ] || { echo "FAIL: tasks.status=$TASK_STATUS（需 completed）"; exit 1; }

VERDICT=$(psql "$DB" -tAc "SELECT result->>'verdict' FROM tasks WHERE id='$DEMO_TASK_ID'")
[ -n "$VERDICT" ] || { echo "FAIL: tasks.result.verdict 字段为空"; exit 1; }

DEV_PR_URL=$(psql "$DB" -tAc "SELECT pr_url FROM dev_records WHERE task_id='$DEMO_TASK_ID' ORDER BY created_at DESC LIMIT 1")
DEV_MERGED=$(psql "$DB" -tAc "SELECT merged_at FROM dev_records WHERE task_id='$DEMO_TASK_ID' ORDER BY created_at DESC LIMIT 1")
[ -n "$DEV_PR_URL" ] || { echo "FAIL: dev_records.pr_url 为空"; exit 1; }
[ -n "$DEV_MERGED" ] || { echo "FAIL: dev_records.merged_at 为空"; exit 1; }
[ "$DEV_PR_URL" = "$TRACE_URL" ] || { echo "FAIL: dev_records.pr_url ($DEV_PR_URL) 与 fix 循环 trace url ($TRACE_URL) 不一致"; exit 1; }

echo "PASS: task completed verdict=$VERDICT，dev_records pr_url=$DEV_PR_URL merged_at=$DEV_MERGED"
```

**硬阈值**: status='completed'；result.verdict 非空（PASS 或 FAIL 都接受 — 本 sprint 验"系统真跑通"，不验"演练任务必 PASS"）；dev_records.pr_url 与 trace url 字面相等；merged_at 非空。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
set -e
cd "$(git rev-parse --show-toplevel)"

EVID="sprints/w41-walking-skeleton-final-b19/evidence"
[ -d "$EVID" ] || { echo "FAIL: evidence/ 目录缺失"; exit 1; }

# Pre-check：5 件证据文件齐全
for f in seed-output.json pr-url-trace.txt evaluator-checkout-proof.txt; do
  [ -s "$EVID/$f" ] || { echo "FAIL: $EVID/$f 缺失或空"; exit 1; }
done

DB="${DB:-postgresql://localhost/cecelia}"
DEMO_TASK_ID=$(jq -er '.demo_task_id' "$EVID/seed-output.json")

# Step 1：seed 写入 tasks
COUNT=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='$DEMO_TASK_ID' AND task_type LIKE 'harness_%' AND created_at > NOW() - interval '24 hours'")
[ "$COUNT" = "1" ] || { echo "FAIL Step1: tasks 缺行 (count=$COUNT)"; exit 1; }

# Step 2：fix 循环触发 ≥ 2 次 evaluate dispatch
EVAL_COUNT=$(psql "$DB" -tAc "
  SELECT count(*) FROM dispatch_events
  WHERE (task_id='$DEMO_TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE payload->>'parent_task_id'='$DEMO_TASK_ID'))
  AND event_type='dispatched'
  AND COALESCE(reason,'') ILIKE '%harness_evaluate%'
  AND created_at > NOW() - interval '24 hours'")
[ "$EVAL_COUNT" -ge 2 ] || { echo "FAIL Step2: harness_evaluate dispatch=$EVAL_COUNT 不足 2"; exit 1; }

# Step 3：pr_url + pr_branch 跨轮一致
ROUNDS=$(wc -l < "$EVID/pr-url-trace.txt" | tr -d ' ')
UNIQUE_URLS=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print $i}' "$EVID/pr-url-trace.txt" | sort -u | wc -l | tr -d ' ')
UNIQUE_BRANCHES=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_branch=/)print $i}' "$EVID/pr-url-trace.txt" | sort -u | wc -l | tr -d ' ')
[ "$ROUNDS" -ge 2 ] || { echo "FAIL Step3: trace 仅 $ROUNDS 行"; exit 1; }
[ "$UNIQUE_URLS" = "1" ] || { echo "FAIL Step3: pr_url 跨轮漂 unique=$UNIQUE_URLS"; exit 1; }
[ "$UNIQUE_BRANCHES" = "1" ] || { echo "FAIL Step3: pr_branch 跨轮漂 unique=$UNIQUE_BRANCHES"; exit 1; }

# Step 4：evaluator 真在 PR 分支跑
PR_BRANCH=$(grep -E '^PR_BRANCH=' "$EVID/evaluator-checkout-proof.txt" | head -1 | cut -d= -f2)
HEAD_SHA=$(grep -E '^evaluator_HEAD=' "$EVID/evaluator-checkout-proof.txt" | head -1 | cut -d= -f2)
[ "$PR_BRANCH" != "main" ] || { echo "FAIL Step4: PR_BRANCH=main"; exit 1; }
git fetch origin "$PR_BRANCH" 2>/dev/null || true
EXPECTED=$(git rev-parse "origin/$PR_BRANCH" 2>/dev/null)
MAIN_HEAD=$(git rev-parse origin/main 2>/dev/null)
[ "$HEAD_SHA" = "$EXPECTED" ] || { echo "FAIL Step4: HEAD ($HEAD_SHA) ≠ origin/$PR_BRANCH ($EXPECTED)"; exit 1; }
[ "$HEAD_SHA" != "$MAIN_HEAD" ] || { echo "FAIL Step4: HEAD 等于 origin/main"; exit 1; }

# Step 5：task completed + dev_records 写齐
TASK_STATUS=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$DEMO_TASK_ID'")
[ "$TASK_STATUS" = "completed" ] || { echo "FAIL Step5: tasks.status=$TASK_STATUS"; exit 1; }
VERDICT=$(psql "$DB" -tAc "SELECT result->>'verdict' FROM tasks WHERE id='$DEMO_TASK_ID'")
[ -n "$VERDICT" ] || { echo "FAIL Step5: result.verdict 空"; exit 1; }
DEV_PR_URL=$(psql "$DB" -tAc "SELECT pr_url FROM dev_records WHERE task_id='$DEMO_TASK_ID' ORDER BY created_at DESC LIMIT 1")
DEV_MERGED=$(psql "$DB" -tAc "SELECT merged_at FROM dev_records WHERE task_id='$DEMO_TASK_ID' ORDER BY created_at DESC LIMIT 1")
[ -n "$DEV_PR_URL" ] && [ -n "$DEV_MERGED" ] || { echo "FAIL Step5: dev_records.pr_url 或 merged_at 空"; exit 1; }
TRACE_URL=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print substr($i,8)}' "$EVID/pr-url-trace.txt" | sort -u | head -1)
[ "$DEV_PR_URL" = "$TRACE_URL" ] || { echo "FAIL Step5: dev_records.pr_url 与 trace 不一致"; exit 1; }

# 报告完整性
REPORT="sprints/w41-walking-skeleton-final-b19/verification-report.md"
[ -s "$REPORT" ] || { echo "FAIL: verification-report.md 缺失"; exit 1; }
for SECTION in "B19 fix evidence" "PR_BRANCH 传递" "evaluator 在 PR 分支" "fix 循环" "task completed"; do
  grep -qF "$SECTION" "$REPORT" || { echo "FAIL: report 缺章节 '$SECTION'"; exit 1; }
done
grep -qE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' "$REPORT" || { echo "FAIL: report 无可点 PR URL"; exit 1; }

echo "✅ Golden Path 5 步全过 + 报告完整 (verdict=$VERDICT, fix_rounds=$ROUNDS, evaluate_dispatches=$EVAL_COUNT)"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 2

### Workstream 1: 演练任务注入 + 端到端驱动 + 原始证据采集

**范围**:
- 写 `packages/brain/scripts/seed-w41-demo-task.js` — 注入一个**故意第 1 轮 FAIL 第 2 轮 PASS** 的 harness W 任务（如 playground 加 GET /factorial endpoint，第 1 轮实现遗漏 0! = 1 的 base case，evaluator 抓到 → fix → 第 2 轮补 base case → PASS）
- 写驱动脚本 `packages/brain/scripts/drive-w41-e2e.js`：POST seed → 轮询 brain `/api/brain/tasks/:id` 直到 status='completed' 或超时（30 min）→ 全程从 brain logs / DB 抽取 pr-url-trace + evaluator-checkout-proof
- 输出 `sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json`、`pr-url-trace.txt`、`evaluator-checkout-proof.txt`、`dispatch-events.csv`、`brain-log-excerpt.txt`

**大小**: M（100-300 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/seed-and-drive.test.ts`（vitest，generator TDD red-green 用，**不当 evaluator oracle**）

---

### Workstream 2: verification-report.md 写作（5 类证据章节）

**范围**:
- 写 `sprints/w41-walking-skeleton-final-b19/verification-report.md`
- 必含 5 个 H2 章节，章节标题字面值（evaluator grep 检测）：
  1. `## B19 fix evidence — fixDispatchNode 跨轮保留 pr_url + pr_branch`
  2. `## PR_BRANCH 传递 — final evaluate_contract spawn env 实证`
  3. `## evaluator 在 PR 分支跑 — git rev-parse 比对`
  4. `## fix 循环触发证据 — dispatch_events 派发链`
  5. `## task completed 收敛 — dev_records merged_at + pr_url 一致性`
- 每章节含至少 1 个可点 PR URL 或 brain log 行号引用
- 末尾 `## 结论` 段：1 句话总结 B14–B19 是否真协同生效

**大小**: S（< 100 行）
**依赖**: WS1 完成（需读 evidence/）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/report-format.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/seed-and-drive.test.ts` | seed 脚本导出 buildDemoTaskPayload() 返回 task_type 以 harness_ 开头；drive 脚本导出 collectEvidence() 返回 5 个键 | 模块未实现 → import 失败 |
| WS2 | `tests/ws2/report-format.test.ts` | report 生成器 buildReport(evidence) 返回 markdown，含 5 个指定章节标题 | 模块未实现 → import 失败 |
