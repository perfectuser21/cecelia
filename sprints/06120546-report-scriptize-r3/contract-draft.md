# Sprint Contract Draft (Round 5)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 产物为 CLI 脚本（packages/brain/scripts/harness-report.mjs），无 HTTP 端点。Response Schema 不适用。

## 已知约束（来自回归测试）

- [harness-initiative.graph.js] → reportNode 源码含 step_timing / ws_issues / ws_costs
- [harness-initiative.graph.js] → reportNode 含 report_content 键写入 tasks.result
- [harness-initiative.graph.js] → 禁用字段（timings/timing/issues/costs/breakdown）不作为 reportNode 独立键名
- [harness-reporter-payload.test.js] → reportNode spawn harness_report payload 含 gan_rounds / gan_cost_usd 字段
- [report-step6-refs-events.test.ts] → initiative_run_events owner = Brain 侧 events/initiativeRunEvents.js（含 ts_end/cost_usd/model 三列）
- [cecelia-pipeline-viz-v2/tests/ws4] → reportNode 写 step_timing / ws_issues / ws_costs 到 tasks.result
- [SKILL.md line 299] → 表名提取用 `awk '{print $2}'`（`$1` 是旧损坏模式，新脚本禁用）
- [SKILL.md line 214] → `"thickness":"done"` 为非法值；有效枚举 = `['thin','medium','thick','mature']`；S6 仅更新 status，不写 thickness

## Golden Path

[reportNode 派发 harness_report 子任务] → [harness-report.mjs 7 步顺序执行] → [报告产物落盘 + Brain API 回写完毕 + 宿主 git 状态不变]

---

### Step 1: CLI 调用入口 — 接收参数并读取 sprint-dir 产物

**来源**: `[FROM_PRD]` — PRD "入口" 段直接定义（`node packages/brain/scripts/harness-report.mjs --sprint-dir <dir> --task-id <id> --pr-url <url> --feature-id <fid>`）

**可观测行为**: 脚本以 exit code 0 启动（或非零+PARTIAL_FAIL 在部分失败时），stdout 输出各文件路径

**验证命令**:
```bash
node packages/brain/scripts/harness-report.mjs --help 2>&1 | grep -E "sprint-dir|task-id|pr-url|feature-id" || \
  (node packages/brain/scripts/harness-report.mjs --sprint-dir /tmp/test-sprint --task-id fake --pr-url http://x --feature-id fake 2>&1 | grep -E "sprint-dir|task-id|PARTIAL_FAIL|harness-report" && echo "CLI 可执行")
```

**硬阈值**: 脚本文件存在且可由 node 执行（exit code ≠ 127）

---

### Step 2: S1+S2 — 读产物元数据 → 生成 harness-report.md

**来源**: `[FROM_PRD]` — PRD 步骤 "S1：读 sprint-dir 下产物清单" + "S2：生成 harness-report.md（摘要、DoD 结果、步骤耗时、GAN 轮数）"

**可观测行为**: `<sprint-dir>/harness-report.md` 落盘，含非空摘要段、GAN 轮数字段、产物文件路径列表

**验证命令**:
```bash
# 构造 fixture（用于验证文件生成）
FIXTURE_DIR=$(mktemp -d)
cat > "${FIXTURE_DIR}/sprint-prd.md" << 'PEOF'
# Sprint PRD — test fixture
## journey_type: autonomous
PEOF
cat > "${FIXTURE_DIR}/contract-draft.md" << 'CEOF'
# Contract Draft
## Golden Path
Step 1 → Step 2
CEOF
echo '{"gan_rounds":2,"final_e2e_verdict":"PASS","pr_url":"https://github.com/test/1"}' > "${FIXTURE_DIR}/evaluator-output.json"

# 调用脚本
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000001" \
  --pr-url "https://github.com/perfectuser21/cecelia/pull/9999" \
  --feature-id "00000000-0000-0000-0000-000000000002" 2>&1

# 验证文件存在且含关键字段
[ -f "${FIXTURE_DIR}/harness-report.md" ] || { echo "FAIL: harness-report.md 不存在"; exit 1; }
grep -q "PR\|GAN\|Sprint" "${FIXTURE_DIR}/harness-report.md" || { echo "FAIL: harness-report.md 无摘要内容"; exit 1; }
echo "OK: harness-report.md 生成"
rm -rf "${FIXTURE_DIR}"
```

**硬阈值**: 文件存在 + 内容含 PR/GAN/Sprint 任一关键词

---

### Step 3: S3 — 生成 learning.md

**来源**: `[FROM_PRD]` — PRD 步骤 "S3：生成 learning.md（洞察段；无 LLM 时写占位，有 LLM 可选调用）"

**可观测行为**: `<sprint-dir>/learning.md` 存在，内容非空（至少含占位文本）

**验证命令**:
```bash
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000001" \
  --pr-url "https://github.com/test/1" \
  --feature-id "00000000-0000-0000-0000-000000000002" 2>&1
[ -f "${FIXTURE_DIR}/learning.md" ] || { echo "FAIL: learning.md 不存在"; exit 1; }
grep -qiE "sprint|learning|placeholder|洞察|report" "${FIXTURE_DIR}/learning.md" || { echo "FAIL: learning.md 无内容关键字"; exit 1; }
echo "OK"
rm -rf "${FIXTURE_DIR}"
```

**硬阈值**: 文件存在 + 内容含 sprint/learning/placeholder/洞察/report 至少一个关键词

---

### Step 4: S4 — 生成 index.html

**来源**: `[FROM_PRD]` — PRD 步骤 "S4：生成 index.html（静态可读版）"

**可观测行为**: `<sprint-dir>/index.html` 存在，包含基本 HTML 结构（`<html>` 或 `<!DOCTYPE`）

**验证命令**:
```bash
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000001" \
  --pr-url "https://github.com/test/1" \
  --feature-id "00000000-0000-0000-0000-000000000002" 2>&1
[ -f "${FIXTURE_DIR}/index.html" ] || { echo "FAIL: index.html 不存在"; exit 1; }
grep -qi "html" "${FIXTURE_DIR}/index.html" || { echo "FAIL: index.html 无 HTML 结构"; exit 1; }
echo "OK"
rm -rf "${FIXTURE_DIR}"
```

**硬阈值**: 文件存在且含 `html`（大小写不敏感）

---

### Step 5: S5 — Brain API 回写 task result

**来源**: `[FROM_PRD]` — PRD 步骤 "S5：Brain API 回写 — PATCH tasks/{task-id} result（含 pr_url）"

**可观测行为**: tasks 表中 task_id 对应记录的 result 字段含 pr_url（非空字符串）；status 变为 completed

**验证命令**:
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
TEST_TASK_ID=$(psql $DB -t -c "
  INSERT INTO tasks (title, task_type, status, priority, payload)
  VALUES ('test harness_report', 'harness_report', 'in_progress', 'P2',
          '{\"sprint_dir\":\"/tmp/t\",\"pr_url\":\"https://github.com/test/pr/99\",\"feature_id\":\"00000000-0000-0000-0000-000000000002\"}')
  RETURNING id" | tr -d ' \n')

FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "$TEST_TASK_ID" \
  --pr-url "https://github.com/perfectuser21/cecelia/pull/9999" \
  --feature-id "00000000-0000-0000-0000-000000000002" 2>&1

# S5 验证：result->>'pr_url' 非空 + 时间窗口防造假
PR_URL_VAL=$(psql $DB -t -c "
  SELECT result->>'pr_url' FROM tasks
  WHERE id='${TEST_TASK_ID}'
  AND updated_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ -n "$PR_URL_VAL" ] || { echo "FAIL: tasks.result->>pr_url 为空或时间窗外"; exit 1; }
echo "OK: pr_url=$PR_URL_VAL"
rm -rf "${FIXTURE_DIR}"
psql $DB -c "DELETE FROM tasks WHERE id='${TEST_TASK_ID}'" 2>/dev/null || true
```

**硬阈值**: `result->>'pr_url'` 非空 + 在 5 分钟时间窗内写入

---

### Step 6: S6 — Brain API 回写 journey_features status=done

**来源**: `[FROM_PRD]` — PRD 步骤 "S6：Brain API 回写 — PATCH journey_features/{feature-id} status=done"

**可观测行为**: `journey_features` 表中 feature_id 对应行的 status 字段 = 'done'（5 分钟时间窗内更新）

**验证命令**:
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
TEST_FEATURE_ID=$(psql $DB -t -c "
  INSERT INTO journey_features (name, journey_id, kind, status, thickness)
  VALUES ('test-report-feature', 'cecelia-harness-pipeline', 'feature', 'active', 'thin')
  ON CONFLICT DO NOTHING
  RETURNING id" | tr -d ' \n')
[ -z "$TEST_FEATURE_ID" ] && TEST_FEATURE_ID=$(psql $DB -t -c "
  SELECT id FROM journey_features WHERE name='test-report-feature' LIMIT 1" | tr -d ' \n')

FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
TEST_TASK_ID=$(psql $DB -t -c "
  INSERT INTO tasks (title, task_type, status, priority, payload)
  VALUES ('test-s6', 'harness_report', 'in_progress', 'P2', '{\"sprint_dir\":\"/tmp\",\"pr_url\":\"https://github.com/test/1\",\"feature_id\":\"${TEST_FEATURE_ID}\"}')
  RETURNING id" | tr -d ' \n')

node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "$TEST_TASK_ID" \
  --pr-url "https://github.com/test/1" \
  --feature-id "$TEST_FEATURE_ID" 2>&1

# ✅ R3修复：Brain GET /journey_features/:id 不存在，改用 psql 直查（带时间窗防造假）
STATUS=$(psql $DB -t -c "
  SELECT status FROM journey_features
  WHERE id='${TEST_FEATURE_ID}'
  AND updated_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ "$STATUS" = "done" ] || { echo "FAIL: journey_features.status='${STATUS}' (expected done，或时间窗外)"; exit 1; }
echo "OK: feature status=done"
rm -rf "${FIXTURE_DIR}"
psql $DB -c "DELETE FROM tasks WHERE id='$TEST_TASK_ID'; DELETE FROM journey_features WHERE id='$TEST_FEATURE_ID'" 2>/dev/null || true
```

**硬阈值**: psql 查 `journey_features.status = 'done'`，5 分钟时间窗内写入

---

### Step 7: S7 — Brain API 创建 Note 记录

**来源**: `[FROM_PRD]` — PRD 步骤 "S7：Brain API 回写 — POST notes（Report note 关联 task）"

**可观测行为**: notes 表新增记录，type 为 report 相关类型，在 5 分钟内写入

**验证命令**:
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
TEST_TASK_ID=$(psql $DB -t -c "
  INSERT INTO tasks (title, task_type, status, priority, payload)
  VALUES ('test-s7', 'harness_report', 'in_progress', 'P2', '{\"sprint_dir\":\"/tmp\",\"pr_url\":\"https://github.com/test/7\",\"feature_id\":\"fake\"}')
  RETURNING id" | tr -d ' \n')

node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "$TEST_TASK_ID" \
  --pr-url "https://github.com/test/7" \
  --feature-id "fake" 2>&1

COUNT=$(psql $DB -t -c "
  SELECT count(*) FROM notes
  WHERE created_at > NOW() - interval '5 minutes'
  AND (title LIKE '%Report%' OR title LIKE '%harness%' OR type = 'report')" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: 无本轮 report note 记录（时间窗 5min）"; exit 1; }
echo "OK: notes count=$COUNT"
rm -rf "${FIXTURE_DIR}"
psql $DB -c "DELETE FROM tasks WHERE id='$TEST_TASK_ID'" 2>/dev/null || true
```

**硬阈值**: 5 分钟内 notes 表新增 ≥1 条 report 类型记录

---

### Step 8: 幂等性 — 重复执行退出码 0

**来源**: `[FROM_PRD]` — PRD "幂等验证：同命令重复执行 → 退出码 0，文件内容覆写一致，API 回写幂等（PATCH 同值）"

**可观测行为**: 第二次调用相同参数，exit code = 0

**验证命令**:
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
TEST_TASK_ID=$(psql $DB -t -c "
  INSERT INTO tasks (title, task_type, status, priority, payload)
  VALUES ('test-idempotent', 'harness_report', 'in_progress', 'P2', '{\"sprint_dir\":\"/tmp\",\"pr_url\":\"https://github.com/test/1\",\"feature_id\":\"fake\"}')
  RETURNING id" | tr -d ' \n')
CMD="node packages/brain/scripts/harness-report.mjs --sprint-dir ${FIXTURE_DIR} --task-id ${TEST_TASK_ID} --pr-url https://github.com/test/1 --feature-id fake"
$CMD 2>&1 || { echo "WARN: 第 1 次调用失败（非阻断，继续测幂等）"; }
$CMD; SECOND_EXIT=$?
[ "$SECOND_EXIT" -eq 0 ] || { echo "FAIL: 重复执行退出码 $SECOND_EXIT（期望 0）"; exit 1; }
echo "OK: 幂等性通过"
rm -rf "${FIXTURE_DIR}"
psql $DB -c "DELETE FROM tasks WHERE id='$TEST_TASK_ID'" 2>/dev/null || true
```

**硬阈值**: 第二次执行 exit code = 0

---

### Step 9: git 零接触 — 执行前后 git 状态一致

**来源**: `[FROM_PRD]` — PRD "git 零接触：执行前后 git status --porcelain 与 git branch --show-current 完全一致，报告产物均为 untracked 文件"

**可观测行为**: `git status --porcelain` 输出字节对比相等；`git branch --show-current` 不变

**验证命令**:
```bash
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
GIT_BEFORE=$(git status --porcelain 2>/dev/null | sort | md5sum)
BRANCH_BEFORE=$(git branch --show-current 2>/dev/null)
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000001" \
  --pr-url "https://github.com/test/1" \
  --feature-id "fake" 2>&1
GIT_AFTER=$(git status --porcelain 2>/dev/null | sort | md5sum)
BRANCH_AFTER=$(git branch --show-current 2>/dev/null)
[ "$GIT_BEFORE" = "$GIT_AFTER" ] || { echo "FAIL: git status 变化 before=${GIT_BEFORE} after=${GIT_AFTER}"; exit 1; }
[ "$BRANCH_BEFORE" = "$BRANCH_AFTER" ] || { echo "FAIL: git branch 变化"; exit 1; }
echo "OK: git 零接触"
rm -rf "${FIXTURE_DIR}"
```

**硬阈值**: `git status --porcelain` md5sum 执行前后相等

---

### Step 10: PARTIAL_FAIL — 单步 API 502 不中断，结尾输出 PARTIAL_FAIL

**来源**: `[FROM_PRD]` — PRD 边界情况 "Notion / Brain API 单步 502/timeout：不中断其余步骤，仅记录失败，结尾汇报"

**可观测行为**: 当 Brain API 不可达时，文件生成步骤（S2/S3/S4）仍完成，退出码非零，stdout 含 `PARTIAL_FAIL`

**验证命令**:
```bash
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
OUTPUT=$(BRAIN_URL=http://localhost:19999 node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000099" \
  --pr-url "https://github.com/test/1" \
  --feature-id "fake" 2>&1) || EXIT_CODE=$?
[ "${EXIT_CODE:-0}" -ne 0 ] || { echo "FAIL: 预期非零退出码"; exit 1; }
echo "$OUTPUT" | grep -q "PARTIAL_FAIL" || { echo "FAIL: 无 PARTIAL_FAIL 输出"; exit 1; }
[ -f "${FIXTURE_DIR}/harness-report.md" ] || { echo "FAIL: PARTIAL_FAIL 后 harness-report.md 未生成"; exit 1; }
echo "OK: PARTIAL_FAIL 行为正确"
rm -rf "${FIXTURE_DIR}"
```

**硬阈值**: exit code ≠ 0 + stdout 含 `PARTIAL_FAIL` + harness-report.md 仍生成

---

### Step 11: 降级报告 — sprint-dir 缺产物时 harness-report.md 含 N/A 占位

**来源**: `[FROM_PRD]` — PRD 边界情况 "sprint-dir 缺产物（evaluator-output.json 不存在）：生成降级报告（字段填 N/A），不崩溃"

**可观测行为**: `evaluator-output.json` 不存在时，`harness-report.md` 仍生成，GAN 轮数等字段填 `N/A`

**验证命令**:
```bash
FIXTURE_DIR=$(mktemp -d)
echo "# test" > "${FIXTURE_DIR}/sprint-prd.md"
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000001" \
  --pr-url "https://github.com/test/1" \
  --feature-id "fake" 2>&1
[ -f "${FIXTURE_DIR}/harness-report.md" ] || { echo "FAIL: 降级场景 harness-report.md 未生成"; exit 1; }
grep -qi "N/A\|n/a\|missing\|not found\|降级" "${FIXTURE_DIR}/harness-report.md" || { echo "FAIL: 降级报告未含 N/A 占位"; exit 1; }
echo "OK: 降级报告正常"
rm -rf "${FIXTURE_DIR}"
```

**硬阈值**: harness-report.md 存在 + 含 `N/A`（大小写不敏感）

---

## E2E 验收（最终 final-e2e 跑 — local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

DB="${DB_URL:-postgresql://localhost/cecelia}"

echo "=== harness-report.mjs E2E 验收开始 ==="

# ────────────── 1. 构造 fixture sprint-dir ──────────────
FIXTURE_DIR=$(mktemp -d)
trap "rm -rf ${FIXTURE_DIR}" EXIT

cat > "${FIXTURE_DIR}/sprint-prd.md" << 'PEOF'
# Sprint PRD — E2E fixture
## journey_type: autonomous
## target_environment: local_api
PEOF

cat > "${FIXTURE_DIR}/contract-draft.md" << 'CEOF'
# Contract Draft (Round 1)
## Golden Path
Step 1 → Step 2 → Step 3
CEOF

cat > "${FIXTURE_DIR}/contract-dod.md" << 'DEOF'
# Contract DoD
- [ ] [ARTIFACT] harness-report.md exists
- [ ] [BEHAVIOR] file has content
DEOF

echo '{"gan_rounds":2,"final_e2e_verdict":"PASS","pr_url":"https://github.com/perfectuser21/cecelia/pull/9999"}' \
  > "${FIXTURE_DIR}/evaluator-output.json"

# ────────────── 2. 预置 DB 测试数据 ──────────────
TEST_FEATURE_ID=$(psql "$DB" -t -c "
  INSERT INTO journey_features (name, journey_id, kind, status, thickness)
  VALUES ('e2e-test-report-feature', 'cecelia-harness-pipeline', 'feature', 'active', 'thin')
  RETURNING id" | tr -d ' \n')

TEST_TASK_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (title, task_type, status, priority, payload)
  VALUES ('E2E harness_report test', 'harness_report', 'in_progress', 'P2',
          json_build_object(
            'sprint_dir', '${FIXTURE_DIR}',
            'pr_url', 'https://github.com/perfectuser21/cecelia/pull/9999',
            'feature_id', '${TEST_FEATURE_ID}'
          )::jsonb)
  RETURNING id" | tr -d ' \n')

echo "Fixture: TASK=${TEST_TASK_ID} FEATURE=${TEST_FEATURE_ID} DIR=${FIXTURE_DIR}"

# ────────────── 3. git 快照（零接触验证基线）──────────────
GIT_BEFORE=$(git status --porcelain 2>/dev/null | sort | md5sum)
BRANCH_BEFORE=$(git branch --show-current 2>/dev/null)

# ────────────── 4. 调用 harness-report.mjs ──────────────
SCRIPT_OUTPUT=$(node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "${TEST_TASK_ID}" \
  --pr-url "https://github.com/perfectuser21/cecelia/pull/9999" \
  --feature-id "${TEST_FEATURE_ID}" 2>&1)
SCRIPT_EXIT=$?
echo "--- script output ---"
echo "$SCRIPT_OUTPUT"
echo "--- exit=$SCRIPT_EXIT ---"
[ "$SCRIPT_EXIT" -eq 0 ] || { echo "FAIL: 脚本退出码 $SCRIPT_EXIT（期望 0）"; exit 1; }

# ────────────── 5. 验收点 1: 文件生成 ──────────────
[ -f "${FIXTURE_DIR}/harness-report.md" ] || { echo "FAIL: harness-report.md 不存在"; exit 1; }
[ -s "${FIXTURE_DIR}/harness-report.md" ] || { echo "FAIL: harness-report.md 为空"; exit 1; }
[ -f "${FIXTURE_DIR}/learning.md" ] || { echo "FAIL: learning.md 不存在"; exit 1; }
grep -qiE "sprint|learning|placeholder|洞察|report" "${FIXTURE_DIR}/learning.md" || { echo "FAIL: learning.md 无内容关键字 (sprint/learning/placeholder/report)"; exit 1; }
[ -f "${FIXTURE_DIR}/index.html" ] || { echo "FAIL: index.html 不存在"; exit 1; }
grep -qi "html" "${FIXTURE_DIR}/index.html" || { echo "FAIL: index.html 无 HTML 结构"; exit 1; }
echo "✅ 验收点 1: 三文件生成正常"

# ────────────── 6. 验收点 2: S5 tasks result 回写（时间窗防造假）──────────────
PR_URL_VAL=$(psql "$DB" -t -c "
  SELECT result->>'pr_url' FROM tasks
  WHERE id='${TEST_TASK_ID}'
  AND updated_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ -n "$PR_URL_VAL" ] || { echo "FAIL: tasks.result->>pr_url 为空或时间窗外"; exit 1; }
echo "✅ 验收点 2: S5 result.pr_url=$PR_URL_VAL"

# ────────────── 7. 验收点 3: S6 journey_features status=done ──────────────
# ✅ R3修复：Brain 无 GET /journey_features/:id，改用 psql 直查（带时间窗防造假）
FEAT_STATUS=$(psql "$DB" -t -c "
  SELECT status FROM journey_features
  WHERE id='${TEST_FEATURE_ID}'
  AND updated_at > NOW() - interval '5 minutes'" | tr -d ' \n')
[ "$FEAT_STATUS" = "done" ] || { echo "FAIL: journey_features.status='${FEAT_STATUS}' (expected done，或时间窗外)"; exit 1; }
echo "✅ 验收点 3: S6 feature status=done"

# ────────────── 8. 验收点 4: S7 notes 记录（时间窗防造假）──────────────
NOTES_COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM notes
  WHERE created_at > NOW() - interval '5 minutes'
  AND (title LIKE '%Report%' OR title LIKE '%harness%' OR title LIKE '%Sprint%' OR type = 'report')" | tr -d ' ')
[ "${NOTES_COUNT:-0}" -ge 1 ] || { echo "FAIL: 无本轮 note 记录（5min 时间窗）"; exit 1; }
echo "✅ 验收点 4: S7 notes count=${NOTES_COUNT}"

# ────────────── 9. 验收点 5: 幂等性 ──────────────
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE_DIR}" \
  --task-id "${TEST_TASK_ID}" \
  --pr-url "https://github.com/perfectuser21/cecelia/pull/9999" \
  --feature-id "${TEST_FEATURE_ID}" 2>&1 >/dev/null
IDEMPOTENT_EXIT=$?
[ "$IDEMPOTENT_EXIT" -eq 0 ] || { echo "FAIL: 重复执行退出码 $IDEMPOTENT_EXIT"; exit 1; }
echo "✅ 验收点 5: 幂等性通过"

# ────────────── 10. 验收点 6: git 零接触 ──────────────
GIT_AFTER=$(git status --porcelain 2>/dev/null | sort | md5sum)
BRANCH_AFTER=$(git branch --show-current 2>/dev/null)
[ "$GIT_BEFORE" = "$GIT_AFTER" ] || { echo "FAIL: git status 变化 before=${GIT_BEFORE} after=${GIT_AFTER}"; exit 1; }
[ "$BRANCH_BEFORE" = "$BRANCH_AFTER" ] || { echo "FAIL: git branch 变化 $BRANCH_BEFORE → $BRANCH_AFTER"; exit 1; }
echo "✅ 验收点 6: git 零接触"

# ────────────── 11. 验收点 7: PARTIAL_FAIL 行为 ──────────────
PARTIAL_DIR=$(mktemp -d)
echo "# test" > "${PARTIAL_DIR}/sprint-prd.md"
PARTIAL_OUT=$(BRAIN_URL=http://localhost:19999 node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${PARTIAL_DIR}" \
  --task-id "00000000-0000-0000-0000-000000000099" \
  --pr-url "https://github.com/test/1" \
  --feature-id "fake" 2>&1) || PARTIAL_EXIT=$?
[ "${PARTIAL_EXIT:-0}" -ne 0 ] || { echo "FAIL: PARTIAL_FAIL 场景期望非零退出"; exit 1; }
echo "$PARTIAL_OUT" | grep -q "PARTIAL_FAIL" || { echo "FAIL: PARTIAL_FAIL 输出未见 PARTIAL_FAIL 字样"; exit 1; }
[ -f "${PARTIAL_DIR}/harness-report.md" ] || { echo "FAIL: PARTIAL_FAIL 场景 harness-report.md 仍应生成"; exit 1; }
rm -rf "${PARTIAL_DIR}"
echo "✅ 验收点 7: PARTIAL_FAIL 行为正确"

# ────────────── 12. 清理 ──────────────
psql "$DB" -c "
  DELETE FROM notes WHERE created_at > NOW() - interval '10 minutes' AND title LIKE '%E2E%';
  DELETE FROM tasks WHERE id='${TEST_TASK_ID}';
  DELETE FROM journey_features WHERE id='${TEST_FEATURE_ID}';" 2>/dev/null || true

echo ""
echo "✅ Golden Path E2E 全部 7 个验收点通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| harness-report.mjs 7 步实现 | `packages/brain/scripts/__tests__/harness-report.test.mjs` | 文件生成 + API 回写 + 幂等 + PARTIAL_FAIL + git 零接触 + 降级报告 | → 8 failures (文件/脚本不存在) |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/harness-report.test.js` | 脚本文件存在/harness-report.md 生成/PARTIAL_FAIL/git status --porcelain/重复执行 | WS1 未实现时 9 failures |

## Risks（结构化风险登记）

| # | 风险 | 触发条件 | 降级行为 | 对应 [BEHAVIOR] |
|---|---|---|---|---|
| R1 | Brain API 不可达 | S5/S6/S7 调用 localhost:5221 返回 5xx 或连接拒绝 | 其余步骤继续执行；结尾输出 `PARTIAL_FAIL` + 非零退出码 | [BEHAVIOR] PARTIAL_FAIL |
| R2 | sprint-dir 缺产物 | `evaluator-output.json` 不存在 | harness-report.md 仍生成，对应字段填 `N/A`；退出码 0 | [BEHAVIOR] 降级报告 |

gate-allow: cheat/or-true 各步骤（Step5/6/7/8）及 E2E 末尾的 teardown 清理行均为删除测试数据，属非断言操作，清理失败不影响验收结论
