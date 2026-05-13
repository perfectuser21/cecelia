# Sprint Contract Draft (Round 2)

> **journey_type**: autonomous（Brain 内部 task graph 端到端验证）
> **本质**：验证 sprint —— B14–B19 已 merge，本轮造演练 W 任务驱 harness-task graph 跑完、收 5 类证据、写报告。不改 Brain 源码。

## Golden Path

[seed 演练 task] → [graph 跑：spawn→evaluate FAIL→fix_dispatch（pr_url/pr_branch 保留）→re-spawn 同 PR→final evaluate] → [tasks.completed + dev_records 写齐 + 5 类证据落地]

---

### Step 1: 演练 task 已注入

**可观测行为**: `evidence/seed-output.json` 存在含 demo_task_id + injected_at；`tasks` 表对应行存在，task_type LIKE 'harness_%'，过去 24h 内。

**验证命令**:
```bash
SEED="sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json"
[ -s "$SEED" ] || { echo "FAIL: seed-output.json 缺失"; exit 1; }
ID=$(jq -er '.demo_task_id' "$SEED")
DB="${DB:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='$ID' AND task_type LIKE 'harness_%' AND created_at > NOW() - interval '24 hours'")
[ "$COUNT" = "1" ] || { echo "FAIL: tasks 表无对应行 (id=$ID)"; exit 1; }
echo "PASS"
```

**硬阈值**: count=1，injected_at 在 24h 内，demo_task_id 是 UUID v4。

---

### Step 2a: fix 循环真触发（re-spawn generator ≥ 2 次）

**可观测行为**: dispatch_events 中 reason='harness_task' 的 dispatched 事件 ≥ 2 次（初次 + fix 重 spawn），全部 24h 内。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
ID=$(jq -er '.demo_task_id' sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json)
CNT=$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='$ID' OR task_id IN (SELECT id FROM tasks WHERE payload->>'parent_task_id'='$ID')) AND event_type='dispatched' AND reason='harness_task' AND created_at > NOW() - interval '24 hours'")
[ "$CNT" -ge 2 ] || { echo "FAIL: harness_task dispatch=$CNT < 2，证 fix loop 未触发 re-spawn"; exit 1; }
echo "PASS: harness_task dispatch=$CNT"
```

**硬阈值**: CNT ≥ 2。

---

### Step 2b: final evaluate 真跑了（≥ 2 次 harness_evaluate dispatch）

**可观测行为**: dispatch_events 中 reason='harness_evaluate' 的 dispatched 事件 ≥ 2 次（首轮 eval FAIL + final eval after fix），全部 24h 内。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
ID=$(jq -er '.demo_task_id' sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json)
CNT=$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='$ID' OR task_id IN (SELECT id FROM tasks WHERE payload->>'parent_task_id'='$ID')) AND event_type='dispatched' AND reason='harness_evaluate' AND created_at > NOW() - interval '24 hours'")
[ "$CNT" -ge 2 ] || { echo "FAIL: harness_evaluate dispatch=$CNT < 2，证 final evaluate 未跑"; exit 1; }
echo "PASS: harness_evaluate dispatch=$CNT"
```

**硬阈值**: CNT ≥ 2。

---

### Step 3: fix 循环全程 pr_url + pr_branch 保留（B19 证据）

**可观测行为**: `evidence/pr-url-trace.txt` 每行格式 `round=N pr_url=https://... pr_branch=cp-xxx`；所有行的 pr_url 字面相等，pr_branch 字面相等，无任何空字段。

**验证命令**:
```bash
T=sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt
[ -s "$T" ] || { echo "FAIL: trace 缺失"; exit 1; }
ROUNDS=$(wc -l < "$T" | tr -d ' ')
[ "$ROUNDS" -ge 2 ] || { echo "FAIL: 仅 $ROUNDS 行 < 2"; exit 1; }
UU=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print $i}' "$T" | sort -u | wc -l | tr -d ' ')
UB=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_branch=/)print $i}' "$T" | sort -u | wc -l | tr -d ' ')
EMPTY=$(grep -cE 'pr_url=(\s|$)|pr_branch=(\s|$)' "$T" || true)
[ "$UU" = "1" ] || { echo "FAIL: pr_url 跨轮漂 unique=$UU"; exit 1; }
[ "$UB" = "1" ] || { echo "FAIL: pr_branch 跨轮漂 unique=$UB"; exit 1; }
[ "$EMPTY" = "0" ] || { echo "FAIL: 存在空字段行 $EMPTY"; exit 1; }
echo "PASS: $ROUNDS 轮 pr_url+pr_branch 全保留"
```

**硬阈值**: ROUNDS ≥ 2 ∧ UU=1 ∧ UB=1 ∧ EMPTY=0。

---

### Step 4: evaluator 真在 PR 分支跑（不在 main）

**可观测行为**: `evidence/evaluator-checkout-proof.txt` 含两行 `PR_BRANCH=<分支名>` 和 `evaluator_HEAD=<sha>`；分支名 ≠ "main"；HEAD == `git rev-parse origin/<PR_BRANCH>` ∧ ≠ `git rev-parse origin/main`。

**验证命令**:
```bash
P=sprints/w41-walking-skeleton-final-b19/evidence/evaluator-checkout-proof.txt
[ -s "$P" ] || { echo "FAIL: proof 缺失"; exit 1; }
PRB=$(grep -E '^PR_BRANCH=' "$P" | head -1 | cut -d= -f2-)
HEAD=$(grep -E '^evaluator_HEAD=' "$P" | head -1 | cut -d= -f2-)
[ -n "$PRB" ] && [ -n "$HEAD" ] || { echo "FAIL: 缺字段"; exit 1; }
[ "$PRB" != "main" ] || { echo "FAIL: PR_BRANCH=main"; exit 1; }
git fetch origin "$PRB" 2>/dev/null || true
EXP=$(git rev-parse "origin/$PRB" 2>/dev/null)
MAIN=$(git rev-parse origin/main 2>/dev/null)
[ "$HEAD" = "$EXP" ] || { echo "FAIL: HEAD($HEAD) ≠ origin/$PRB($EXP)"; exit 1; }
[ "$HEAD" != "$MAIN" ] || { echo "FAIL: HEAD = origin/main"; exit 1; }
echo "PASS: evaluator HEAD=$HEAD 在 PR 分支 $PRB"
```

**硬阈值**: PRB ≠ "main" ∧ HEAD = origin/$PRB ∧ HEAD ≠ origin/main。

---

### Step 5: 端到端收敛 — task=completed + dev_records 写齐

**可观测行为**: `tasks.status='completed'` ∧ `result.verdict` 非空 ∧ `dev_records.pr_url` 与 trace 字面一致 ∧ `merged_at` 非空。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
ID=$(jq -er '.demo_task_id' sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json)
TR=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print substr($i,8)}' sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt | sort -u | head -1)
ST=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$ID'")
V=$(psql "$DB" -tAc "SELECT result->>'verdict' FROM tasks WHERE id='$ID'")
DPR=$(psql "$DB" -tAc "SELECT pr_url FROM dev_records WHERE task_id='$ID' ORDER BY created_at DESC LIMIT 1")
DM=$(psql "$DB" -tAc "SELECT merged_at FROM dev_records WHERE task_id='$ID' ORDER BY created_at DESC LIMIT 1")
[ "$ST" = "completed" ] || { echo "FAIL: tasks.status=$ST"; exit 1; }
[ -n "$V" ] || { echo "FAIL: verdict 空"; exit 1; }
[ -n "$DPR" ] && [ -n "$DM" ] || { echo "FAIL: dev_records 字段空"; exit 1; }
[ "$DPR" = "$TR" ] || { echo "FAIL: dev_records.pr_url($DPR) ≠ trace($TR)"; exit 1; }
echo "PASS: status=completed verdict=$V pr_url=$DPR merged=$DM"
```

**硬阈值**: status='completed' ∧ verdict 非空 ∧ dev_records.pr_url = trace url ∧ merged_at 非空。

---

## E2E 验收（最终 Evaluator 跑）

**完整验证脚本**:
```bash
#!/bin/bash
set -e
cd "$(git rev-parse --show-toplevel)"
EVID="sprints/w41-walking-skeleton-final-b19/evidence"
[ -d "$EVID" ] || { echo "FAIL: evidence/ 缺"; exit 1; }
for f in seed-output.json pr-url-trace.txt evaluator-checkout-proof.txt dispatch-events.csv brain-log-excerpt.txt; do
  [ -s "$EVID/$f" ] || { echo "FAIL: $EVID/$f 缺失"; exit 1; }
done
for step in step1 step2a step2b step3 step4 step5; do
  echo "--- Running $step ---"
done
# 5 步顺序执行（脚本细节见上）
DB="${DB:-postgresql://localhost/cecelia}"
ID=$(jq -er '.demo_task_id' "$EVID/seed-output.json")
# Step 1
[ "$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='$ID' AND task_type LIKE 'harness_%' AND created_at > NOW() - interval '24 hours'")" = "1" ] || exit 1
# Step 2a
[ "$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='$ID' OR task_id IN (SELECT id FROM tasks WHERE payload->>'parent_task_id'='$ID')) AND event_type='dispatched' AND reason='harness_task' AND created_at > NOW() - interval '24 hours'")" -ge 2 ] || exit 1
# Step 2b
[ "$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='$ID' OR task_id IN (SELECT id FROM tasks WHERE payload->>'parent_task_id'='$ID')) AND event_type='dispatched' AND reason='harness_evaluate' AND created_at > NOW() - interval '24 hours'")" -ge 2 ] || exit 1
# Step 3
T="$EVID/pr-url-trace.txt"
ROUNDS=$(wc -l < "$T" | tr -d ' '); UU=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print $i}' "$T" | sort -u | wc -l | tr -d ' '); UB=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_branch=/)print $i}' "$T" | sort -u | wc -l | tr -d ' '); EMPTY=$(grep -cE 'pr_url=(\s|$)|pr_branch=(\s|$)' "$T" || true)
[ "$ROUNDS" -ge 2 ] && [ "$UU" = "1" ] && [ "$UB" = "1" ] && [ "$EMPTY" = "0" ] || exit 1
# Step 4
P="$EVID/evaluator-checkout-proof.txt"
PRB=$(grep -E '^PR_BRANCH=' "$P" | head -1 | cut -d= -f2-); HD=$(grep -E '^evaluator_HEAD=' "$P" | head -1 | cut -d= -f2-)
[ "$PRB" != "main" ] || exit 1
git fetch origin "$PRB" 2>/dev/null || true
[ "$HD" = "$(git rev-parse "origin/$PRB" 2>/dev/null)" ] || exit 1
[ "$HD" != "$(git rev-parse origin/main 2>/dev/null)" ] || exit 1
# Step 5
ST=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$ID'"); V=$(psql "$DB" -tAc "SELECT result->>'verdict' FROM tasks WHERE id='$ID'"); DPR=$(psql "$DB" -tAc "SELECT pr_url FROM dev_records WHERE task_id='$ID' ORDER BY created_at DESC LIMIT 1"); DM=$(psql "$DB" -tAc "SELECT merged_at FROM dev_records WHERE task_id='$ID' ORDER BY created_at DESC LIMIT 1")
TR=$(awk '{for(i=1;i<=NF;i++)if($i~/^pr_url=/)print substr($i,8)}' "$T" | sort -u | head -1)
[ "$ST" = "completed" ] && [ -n "$V" ] && [ -n "$DPR" ] && [ -n "$DM" ] && [ "$DPR" = "$TR" ] || exit 1
# 报告完整性
R="sprints/w41-walking-skeleton-final-b19/verification-report.md"
[ -s "$R" ] || exit 1
for S in "B19 fix evidence" "PR_BRANCH 传递" "evaluator 在 PR 分支" "fix 循环触发证据" "task completed 收敛"; do
  grep -qF "$S" "$R" || exit 1
done
grep -qE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' "$R" || exit 1
echo "✅ Golden Path 全过"
```

**通过标准**: 脚本 exit 0。

---

## Risks（v6 哲学要求）

| Risk | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 演练 task 第 1 轮就 PASS（fix loop 0 次触发，B19 代码路径未覆盖） | M | 验证不充分 | seed 脚本故意在 spec 嵌 markerForFixLoop=true，generator 第 1 轮模板必漏（如 /factorial 漏 0! base case），evaluator 必抓 → 强制进 fix |
| MAX_FIX_ROUNDS=20 内不收敛（demo spec 太难） | L | task=failed，Step 5 status≠completed | demo spec 选已知一行就能修的（base case），LLM 第 2 轮必修对 |
| dispatch_events.reason 实际不是 'harness_task'/'harness_evaluate' 字面值 | M | Step 2a/2b SQL 永远 0 | drive 脚本采集 dispatch-events.csv 时**先 SELECT DISTINCT reason** 落盘核对，contract reviewer 可对照 |
| PR 在验证前被 merge 删分支 → origin/$PR_BRANCH 不存在 | L | Step 4 git rev-parse 失败 | proof 文件**在 evaluator 容器内运行时**采集 HEAD sha，验证时即使分支已删 sha 仍可比 origin/main |
| evidence 文件造假（手工 echo 一个 trace 假装跑过） | L | 假绿 | Step 1 强制 24h 时间窗（防 replay）+ Step 5 dev_records.pr_url 与 trace 交叉验证（伪造需同步伪造 DB） |
| Brain (localhost:5221) 测试时离线 | M | drive 脚本无法 POST 触发 | drive 脚本启动前 health-check `/api/brain/context`，离线立即 exit 1 + 日志，不写空 evidence 装跑过 |

---

## Workstreams

workstream_count: 2

### Workstream 1: seed + drive + evidence 采集

**范围**:
- `packages/brain/scripts/seed-w41-demo-task.js` — 注入故意 1 轮 FAIL / 2 轮 PASS 的 harness W 任务
- `packages/brain/scripts/drive-w41-e2e.js` — POST seed → 轮询 status=completed（超时 30 min）→ 抽 5 类证据
- 输出 5 文件到 `evidence/`：`seed-output.json` / `pr-url-trace.txt` / `evaluator-checkout-proof.txt` / `dispatch-events.csv` / `brain-log-excerpt.txt`

**大小**: M  **依赖**: 无
**BEHAVIOR 覆盖测试**: `tests/ws1/seed-and-drive.test.ts`（vitest，generator TDD 用，**非 evaluator oracle**）

### Workstream 2: verification-report.md 写作

**范围**: 读 evidence/ 产出报告，5 个 H2 章节字面值固定（B19 fix evidence / PR_BRANCH 传递 / evaluator 在 PR 分支 / fix 循环触发证据 / task completed 收敛）+ 末尾 ## 结论 段含 'B19' + (真生效|未生效) 字面之一。每章节含可点 PR URL + 引用 evidence 文件具体行。

**大小**: S  **依赖**: WS1 完成
**BEHAVIOR 覆盖测试**: `tests/ws2/report-format.test.ts`

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/seed-and-drive.test.ts` | buildDemoTaskPayload() / markerForFixLoop=true / collectEvidence() 返回包含 5 个键 / waitForCompletion | 模块未实现 → import 失败 |
| WS2 | `tests/ws2/report-format.test.ts` | buildReport 产物含 5 个指定 H2 章节标题 / ## 结论 段且引用 B19 / trace 里的 pr_url 字面值嵌入 report | 模块未实现 → import 失败 |
