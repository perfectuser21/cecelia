# Sprint Contract Draft (Round 2)

> Sprint: harness-report.mjs 脚本化（机械段下沉 + 幂等 + 宿主 git 隔离）
> journey_type: autonomous | target_environment: local_api（curl localhost:5221 + psql cecelia）
>
> **Round 2 变更摘要**：修复 Reviewer 5 项阻塞——(1) 测试文件路径统一到 packages/brain/src/__tests__/；
> (2) Step 3 幂等 exit code 矛盾：移除"第二次运行 exit 0"空声明，对齐 PRD 409→exit 1 预期；
> (3) 补两条边界情况 BEHAVIOR（sprint-prd.md 缺失 / 某步失败后续继续）；
> (4) Step 2e notes POST 从 ARTIFACT 源码检查升级为运行时 BEHAVIOR；
> (5) 新增 Risks/Mitigation 段。

---

## 被测真实系统声明

本 Sprint 产出 `packages/brain/scripts/harness-report.mjs` 新 CLI 脚本，修改 `reportNode` 机械段改为调脚本。
所有 [BEHAVIOR] 均调用真实 Brain API（localhost:5221）或 psql cecelia，无 mock/stub。
本能力无新增 HTTP 端点（CLI 脚本），故不新增 HTTP [BEHAVIOR]；验证点为脚本的外部可观察产出。

---

## Response Schema（推导来源: PRD 字面）

`N/A — 任务无 HTTP 响应`（CLI 脚本，PRD 明确无 response 契约；无新增 HTTP 端点）。
Reviewer 第 6 维 verification_oracle_completeness 不审 HTTP schema，改审下方 [BEHAVIOR] 对 Golden Path 步骤的 1:1 覆盖完整性。

---

## 已知约束（来自回归测试）

- `VALID_THICKNESS = ['thin', 'medium', 'thick', 'mature']` — 无 `'done'` 枚举值；向 `PATCH /api/brain/journey_features/:id` 发送 `thickness:"done"` 将返 400（routes/journeys.js）
- `PATCH /api/brain/tasks/:task_id` 允许 queued→in_progress→completed 状态机；completed→completed 非法 → 409
- `POST /api/brain/registry` — ON CONFLICT (name, type) DO UPDATE（幂等 upsert）
- `POST /api/brain/notes` 同步写 Notion + Brain DB notes 表；Notion 不可用 → 502（非阻断）

---

## Risks / Mitigation

| 风险 | 可能性 | 影响 | 缓解措施 |
|---|---|---|---|
| 脚本意外调用宿主 git 操作（历史实证：旧 SKILL.md 阶段曾在宿主仓库 git checkout/commit）| 中 | 污染宿主工作树，后续 commit 错乱 | Step 4 git 隔离 BEHAVIOR 验证：执行前后 `git status --porcelain` 字节级不变 + `branch --show-current` 不变 |
| Brain API 5xx（Notion 502 等）导致 notes POST / feature PATCH 失败 | 中 | report 产物不完整，但脚本不崩溃 | 每步独立 try/catch；结尾汇总 ✅/❌；部分失败 exit 1 可机检（Step 6 边界 BEHAVIOR 覆盖） |
| 重跑时 task PATCH 返回 409（completed→completed 非法转换）| 高（幂等跑必发生）| 幂等跑 exit 1（部分失败）——PRD 明确预期行为，非 bug | Step 3 BEHAVIOR 聚焦 registry 不增长；说明 exit 1 为预期；E2E 幂等段用 `IDEMP_EXIT=$?` 捕获不强断 |
| fixture sprint-prd.md 不存在 | 中 | 报告文件生成 WARN+跳过；不影响 API 回写步骤 | Step 5 边界 BEHAVIOR（空 sprint-dir 跑，验证其余步骤继续且 task status = completed）|

---

## Golden Path

[CLI 调用] → [生成报告三文件] → [Brain API 回写 task + feature + registry + notes] → [幂等验证] → [宿主 git 不变]

---

### Step 1: CLI 入口触发
**来源**: `[FROM_PRD]` — PRD 步骤 1 直接定义

**可观测行为**: 命令可执行，所有参数存在时退出码 0；缺少必须参数时输出 usage/error 并退出码非 0

**验证命令**:
```bash
START=$(date +%s)
test -f packages/brain/scripts/harness-report.mjs || { echo "FAIL: 脚本不存在"; exit 1; }
node packages/brain/scripts/harness-report.mjs 2>&1 | grep -qiE "task-id|sprint-dir|usage|required|error" || { echo "FAIL: 缺参数无错误提示"; exit 1; }
END=$(date +%s)
[ $((END-START)) -lt 10 ] || { echo "FAIL: 脚本启动耗时 $((END-START))s ≥ 10s"; exit 1; }
echo OK
```

**硬阈值**: 文件存在；缺参数时有错误提示；启动 < 10s

---

### Step 2a: 生成报告三文件（harness-report.md / learning.md / index.html）
**来源**: `[FROM_PRD]` — PRD 步骤 2a 直接定义

**可观测行为**: sprint-dir 下出现 harness-report.md、learning.md、index.html；harness-report.md 含 Sprint 标识

**验证命令**:
```bash
FIXTURE="sprints/06111555-forensics-no-overwrite-r2"
test -f "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 未生成"; exit 1; }
grep -qE "Sprint:|PR #|━━|harness" "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 格式不符"; exit 1; }
test -f "${FIXTURE}/learning.md" || { echo "FAIL: learning.md 未生成"; exit 1; }
test -f "${FIXTURE}/index.html" || { echo "FAIL: index.html 未生成"; exit 1; }
echo OK
```

**硬阈值**: 三文件均存在；harness-report.md 含 "Sprint:" 或 "PR #" 或 "━━" 之一

---

### Step 2b: PATCH task status=completed
**来源**: `[FROM_PRD]` — PRD 步骤 2b

**可观测行为**: task.status 在 Brain DB 中变为 completed

**验证命令**:
```bash
TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TEST_TASK_ID" | jq -r '.status')
[ "$TASK_STATUS" = "completed" ] || { echo "FAIL: task status=$TASK_STATUS，期望 completed"; exit 1; }
echo OK
```

**硬阈值**: tasks.status = 'completed'

---

### Step 2c: PATCH journey_features — 仅发 status:done（禁发 thickness 字段，修 stale）
**来源**: `[FROM_PRD]` — PRD 步骤 2c + stale 修复

**可观测行为**: journey_features.status 变 done；PATCH 请求体不含 thickness 字段（stale fix）

**验证命令**:
```bash
FEAT_STATUS=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "SELECT status FROM journey_features WHERE id='$TEST_FEAT_ID'" | tr -d ' ')
[ "$FEAT_STATUS" = "done" ] || { echo "FAIL: feature status=$FEAT_STATUS，期望 done"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "localhost:5221/api/brain/journey_features/$TEST_FEAT_ID" \
  -H "Content-Type: application/json" -d '{"thickness":"done"}')
[ "$CODE" = "400" ] || { echo "FAIL: thickness:done 应被拒（400），got $CODE"; exit 1; }
echo OK
```

**硬阈值**: feature.status = 'done'；thickness:"done" 请求返 400

---

### Step 2d: Upsert api_registry / test_registry（幂等）
**来源**: `[FROM_PRD]` — PRD 步骤 2d

**可观测行为**: 首次运行后 registry 有条目；重复运行后条目数 ≤ 首次（幂等）

**验证命令**:
```bash
COUNT_BEFORE=$(curl -sf "localhost:5221/api/brain/registry?limit=1000" | jq '. | length')
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$FIXTURE" --task-id "$TEST_TASK_ID" \
  --pr-url "$PR_URL" --feature-id "$TEST_FEAT_ID" 2>&1 | tail -5; IDEMP_EXIT=$?
# IDEMP_EXIT=1 属预期（task 已 completed → PATCH 409 → 部分失败）
COUNT_AFTER=$(curl -sf "localhost:5221/api/brain/registry?limit=1000" | jq '. | length')
[ "$COUNT_AFTER" -le "$COUNT_BEFORE" ] || { echo "FAIL: registry 在幂等跑后增长（before=$COUNT_BEFORE after=$COUNT_AFTER）"; exit 1; }
echo "OK: registry 幂等验证通过（idempotent_exit=$IDEMP_EXIT）"
```

**硬阈值**: registry 总条目数 ≤ 第一次运行后（ON CONFLICT upsert，非重复插入）；
**注**: 第二次运行因 task PATCH 409（completed→completed 非法转换）exit 1 为 PRD 预期行为（"部分失败 → exit 1"），不断言第二次 exit 0

---

### Step 2e: POST report note（非阻断）
**来源**: `[FROM_PRD]` — PRD 步骤 2e

**可观测行为**: 脚本调用 POST /api/brain/notes；分步汇总中出现 notes 步骤状态（✅ 或 ❌）；Notion 不可用时打印 ❌ WARN 而非崩溃，且 task PATCH 不受影响

**验证命令**:
```bash
OUTPUT=$(node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$FIXTURE" --task-id "$TEST_TASK_ID" \
  --pr-url "$PR_URL" --feature-id "$TEST_FEAT_ID" 2>&1) || true
# notes 步骤出现在分步汇总（✅ 或 ❌ 均可；Notion 不可用时允许 ❌）
echo "$OUTPUT" | grep -qiE "(note|report.note)" || { echo "FAIL: 分步汇总无 notes 步骤输出 output=$OUTPUT"; exit 1; }
# notes 为非阻断步骤：task 应已 completed（不受 notes 502 影响）
TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TEST_TASK_ID" | jq -r '.status')
[ "$TASK_STATUS" = "completed" ] || { echo "FAIL: notes 非阻断，task PATCH 不应因 notes 502 而失败 status=$TASK_STATUS"; exit 1; }
echo OK
```

**硬阈值**: 分步汇总含 notes 步骤输出；task status = completed（notes 不阻断 task PATCH）

---

### Step 2f: 分步汇总退出码
**来源**: `[FROM_PRD]` — PRD 步骤 2f

**可观测行为**: stdout 含 ✅ 汇总行；全部成功时退出码 0

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8');
if(!c.includes('✅') && !c.includes('✅')) { console.error('FAIL: 脚本无 ✅ 汇总输出'); process.exit(1); }
if(!c.includes('process.exit')) { console.error('FAIL: 脚本无 process.exit 控制'); process.exit(1); }
console.log('OK');"
```

**硬阈值**: 脚本含 ✅ 汇总输出逻辑 + process.exit 控制

---

### Step 3: 幂等验证（同命令重复跑）
**来源**: `[FROM_PRD]` — PRD 步骤 3 + 边界情况段"重跑：api_registry / test_registry 行已存在 → ON CONFLICT DO NOTHING"

**可观测行为**: registry 条目数在第二次运行后不增加；第二次运行因 task PATCH 409 exit 1（PRD 定义"部分失败 → exit 1"），此为**预期行为**，非 bug

**验证命令**: 见 Step 2d（registry 幂等断言）；E2E 脚本第 Step 9 捕获 IDEMP_EXIT，不强断为 0

**硬阈值**: registry 条目数不增（幂等核心）；**不断言**第二次运行 exit 0（PRD 允许 exit 1 当某步失败）

---

### Step 4: 宿主 git 不变（隔离验证）
**来源**: `[FROM_PRD]` — PRD 步骤 4
**[AI_ADDED]** — 防止脚本意外调用 `git checkout`/`git commit`；实证：旧 SKILL.md 阶段曾污染宿主 git（PRD 背景段明确提到）

**可观测行为**: 脚本执行前后 `git -C /workspace status --porcelain` 输出字节级不变；`git branch --show-current` 不变

**验证命令**:
```bash
GIT_BEFORE=$(git -C /workspace status --porcelain)
BRANCH_BEFORE=$(git -C /workspace branch --show-current)
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$FIXTURE" --task-id "$TEST_TASK_ID" \
  --pr-url "$PR_URL" --feature-id "$TEST_FEAT_ID" 2>&1 | tail -3; SCRIPT_EXIT=$?
GIT_AFTER=$(git -C /workspace status --porcelain)
BRANCH_AFTER=$(git -C /workspace branch --show-current)
[ "$GIT_AFTER" = "$GIT_BEFORE" ] || { echo "FAIL: git status 被脚本修改"; exit 1; }
[ "$BRANCH_AFTER" = "$BRANCH_BEFORE" ] || { echo "FAIL: git branch 被脚本修改"; exit 1; }
echo "OK (script exit=$SCRIPT_EXIT)"
```

**硬阈值**: git status --porcelain 字节级不变；branch 名不变

---

### Step 5: 边界情况 — sprint-prd.md 缺失时 WARN+跳过，其余步骤继续
**来源**: `[FROM_PRD]` — PRD 边界情况段第 1 项（"sprint-prd.md / contract-draft.md 不存在 → 对应步骤 WARN+跳过，不中断流程"）

**可观测行为**: 无 sprint-prd.md 的空 fixture 目录不导致崩溃；输出含 WARN/skip；task PATCH 仍成功（其余步骤继续）

**验证命令**:
```bash
EMPTY_FIXTURE=$(mktemp -d)
TASK_ID_MISSING=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c \
  "INSERT INTO tasks (title, task_type, status, priority) VALUES ('behavior-missing-prd', 'harness_report', 'in_progress', 'P3') RETURNING id" | tr -d ' ')
FEAT_ID_MISSING=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" \
  -H "Content-Type: application/json" \
  -d '{"name":"behavior-missing-prd-feat","kind":"feature","status":"active"}' | jq -r ".id")
OUTPUT=$(node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$EMPTY_FIXTURE" --task-id "$TASK_ID_MISSING" \
  --pr-url "https://github.com/test/repo/pull/1" --feature-id "$FEAT_ID_MISSING" 2>&1) || true
[ -n "$OUTPUT" ] || { echo "FAIL: 脚本无输出（崩溃？）"; exit 1; }
echo "$OUTPUT" | grep -qiE "warn|skip|not found|缺失|missing" || { echo "FAIL: 缺 sprint-prd.md 时无 WARN/skip 输出 output=$OUTPUT"; exit 1; }
TASK_STATUS_MISSING=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID_MISSING" | jq -r '.status')
[ "$TASK_STATUS_MISSING" = "completed" ] || { echo "FAIL: sprint-prd.md 缺失不应阻断 task PATCH，status=$TASK_STATUS_MISSING"; exit 1; }
rm -rf "$EMPTY_FIXTURE"
echo OK
```

**硬阈值**: 脚本不崩溃（有输出）；输出含 WARN/skip；task PATCH 成功（status=completed）

---

### Step 6: 边界情况 — 某步失败后续步骤继续 + exit 1
**来源**: `[FROM_PRD]` — PRD 边界情况段第 2 项（"Brain API 5xx → 该步骤记 FAIL，后续步骤继续执行，结尾汇总清单 + 非零退出码"）

**可观测行为**: 使用无效 feature ID（→ PATCH 404 模拟步骤失败）；task PATCH 仍成功（后续步骤继续）；script exit 1 + ❌ 汇总

**验证命令**:
```bash
FIXTURE="sprints/06111555-forensics-no-overwrite-r2"
TASK_ID_ERR=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c \
  "INSERT INTO tasks (title, task_type, status, priority) VALUES ('behavior-partial-fail', 'harness_report', 'in_progress', 'P3') RETURNING id" | tr -d ' ')
INVALID_FEAT="00000000-0000-0000-0000-000000000000"
EXIT_CODE=0
OUTPUT=$(node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$FIXTURE" --task-id "$TASK_ID_ERR" \
  --pr-url "https://github.com/test/repo/pull/1" --feature-id "$INVALID_FEAT" 2>&1) || EXIT_CODE=$?
[ "$EXIT_CODE" -ne 0 ] || { echo "FAIL: 部分失败（feature 404）时脚本应 exit 1"; exit 1; }
echo "$OUTPUT" | grep -qE "❌|FAIL" || { echo "FAIL: 脚本无失败汇总 output=$OUTPUT"; exit 1; }
TASK_STATUS_ERR=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID_ERR" | jq -r '.status')
[ "$TASK_STATUS_ERR" = "completed" ] || { echo "FAIL: feature PATCH 失败后 task PATCH 应继续，status=$TASK_STATUS_ERR"; exit 1; }
echo OK
```

**硬阈值**: exit 1（部分失败）；输出含 ❌；task PATCH 不受影响（status=completed）

---

## E2E 验收（final-e2e 跑 — target_environment: local_api）

```bash
#!/bin/bash
set -e

DB="${DB:-postgresql://localhost/cecelia}"
FIXTURE="sprints/06111555-forensics-no-overwrite-r2"

# ── 0. 确认脚本存在 ────────────────────────────────────────────────────────────
test -f packages/brain/scripts/harness-report.mjs || {
  echo "FAIL: packages/brain/scripts/harness-report.mjs 不存在"; exit 1
}
echo "▶ 脚本存在确认"

# ── 1. 创建测试 task（harness_report 类型，in_progress，脚本推进到 completed）────
TEST_TASK_ID=$(psql "$DB" -t -c \
  "INSERT INTO tasks (title, task_type, status, priority) VALUES ('e2e-harness-report-mjs-test', 'harness_report', 'in_progress', 'P3') RETURNING id" | tr -d ' ')
[ -n "$TEST_TASK_ID" ] && [ "$TEST_TASK_ID" != "null" ] || {
  echo "FAIL: 创建测试 task 失败"; exit 1
}
echo "TEST_TASK_ID=$TEST_TASK_ID"

# ── 2. 创建测试 feature ────────────────────────────────────────────────────────
TEST_FEAT_ID=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-report-feat-test","kind":"feature","status":"active"}' | jq -r '.id')
[ -n "$TEST_FEAT_ID" ] && [ "$TEST_FEAT_ID" != "null" ] || {
  echo "FAIL: 创建测试 feature 失败"; exit 1
}
echo "TEST_FEAT_ID=$TEST_FEAT_ID"

# ── 3. 记录 git 基线 ──────────────────────────────────────────────────────────
GIT_STATUS_BEFORE=$(git -C /workspace status --porcelain)
GIT_BRANCH_BEFORE=$(git -C /workspace branch --show-current)
PR_URL="https://github.com/perfectuser21/cecelia/pull/9999"

# ── 4. 第一次运行脚本 ─────────────────────────────────────────────────────────
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$FIXTURE" \
  --task-id "$TEST_TASK_ID" \
  --pr-url "$PR_URL" \
  --feature-id "$TEST_FEAT_ID"
echo "✅ 第一次运行（exit 0）"

# ── 5. 验证报告三文件生成 ──────────────────────────────────────────────────────
test -f "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 未生成"; exit 1; }
grep -qE "Sprint:|PR #|━━|harness" "${FIXTURE}/harness-report.md" || { echo "FAIL: harness-report.md 格式不符"; exit 1; }
test -f "${FIXTURE}/learning.md" || { echo "FAIL: learning.md 未生成"; exit 1; }
test -f "${FIXTURE}/index.html" || { echo "FAIL: index.html 未生成"; exit 1; }
echo "✅ 报告三文件生成验证通过"

# ── 6. 验证 task status=completed ────────────────────────────────────────────
TASK_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$TEST_TASK_ID" | jq -r '.status')
[ "$TASK_STATUS" = "completed" ] || { echo "FAIL: task status=$TASK_STATUS，期望 completed"; exit 1; }
echo "✅ task status=completed"

# ── 7. 验证 feature status=done（stale fix 验证）─────────────────────────────
FEAT_STATUS=$(psql "$DB" -t -c "SELECT status FROM journey_features WHERE id='$TEST_FEAT_ID'" | tr -d ' ')
[ "$FEAT_STATUS" = "done" ] || { echo "FAIL: feature status=$FEAT_STATUS，期望 done"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "localhost:5221/api/brain/journey_features/$TEST_FEAT_ID" \
  -H "Content-Type: application/json" -d '{"thickness":"done"}')
[ "$CODE" = "400" ] || { echo "FAIL: thickness:done 应被 400 拒绝，got $CODE"; exit 1; }
echo "✅ feature status=done + stale fix（thickness:done → 400）"

# ── 8. 幂等验证基线（第一次运行后 registry 条目数）────────────────────────────
REGISTRY_BEFORE=$(curl -sf "localhost:5221/api/brain/registry?limit=1000" | jq '. | length')

# ── 9. 第二次运行（幂等）────────────────────────────────────────────────────────
# 注意：task 已 completed，脚本内部 PATCH tasks 会遇 409（completed→completed 非法）
# → 该步骤记 FAIL，脚本 exit 1（PRD 定义"部分失败 → exit 1"）→ 预期行为
IDEMP_EXIT=0
node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$FIXTURE" \
  --task-id "$TEST_TASK_ID" \
  --pr-url "$PR_URL" \
  --feature-id "$TEST_FEAT_ID" 2>&1 | grep -E "✅|❌|WARN|FAIL|Step" | tail -10 || IDEMP_EXIT=$?
echo "▶ 幂等跑退出码=$IDEMP_EXIT（task 已 completed，PATCH 409 = exit 1 属 PRD 预期行为）"

# ── 10. 验证 registry 幂等（第二次后条目数 ≤ 第一次后）──────────────────────
REGISTRY_AFTER=$(curl -sf "localhost:5221/api/brain/registry?limit=1000" | jq '. | length')
[ "$REGISTRY_AFTER" -le "$REGISTRY_BEFORE" ] || {
  echo "FAIL: registry 在幂等跑后增长 before=$REGISTRY_BEFORE after=$REGISTRY_AFTER"
  exit 1
}
echo "✅ registry 幂等（before=$REGISTRY_BEFORE after=$REGISTRY_AFTER）"

# ── 11. git 隔离验证 ──────────────────────────────────────────────────────────
GIT_STATUS_AFTER=$(git -C /workspace status --porcelain)
GIT_BRANCH_AFTER=$(git -C /workspace branch --show-current)
[ "$GIT_STATUS_AFTER" = "$GIT_STATUS_BEFORE" ] || { echo "FAIL: git status 被脚本修改"; exit 1; }
[ "$GIT_BRANCH_AFTER" = "$GIT_BRANCH_BEFORE" ] || { echo "FAIL: git branch 被脚本修改"; exit 1; }
echo "✅ 宿主 git 隔离（status 和 branch 均未改变）"

# ── 12. 边界情况验证：sprint-prd.md 缺失时不中断其余步骤 ─────────────────────
EMPTY_FIXTURE=$(mktemp -d)
TASK_ID_MISSING=$(psql "$DB" -t -c \
  "INSERT INTO tasks (title, task_type, status, priority) VALUES ('e2e-missing-prd', 'harness_report', 'in_progress', 'P3') RETURNING id" | tr -d ' ')
FEAT_ID_MISSING=$(curl -sf -X POST "localhost:5221/api/brain/journey_features" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-missing-prd-feat","kind":"feature","status":"active"}' | jq -r '.id')
MISSING_OUT=$(node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "$EMPTY_FIXTURE" --task-id "$TASK_ID_MISSING" \
  --pr-url "$PR_URL" --feature-id "$FEAT_ID_MISSING" 2>&1) || true
echo "$MISSING_OUT" | grep -qiE "warn|skip|not found|缺失|missing" || {
  echo "FAIL: sprint-prd.md 缺失时无 WARN/skip 输出"; exit 1
}
TASK_STATUS_MISSING=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID_MISSING" | jq -r '.status')
[ "$TASK_STATUS_MISSING" = "completed" ] || {
  echo "FAIL: sprint-prd.md 缺失不应阻断 task PATCH status=$TASK_STATUS_MISSING"; exit 1
}
rm -rf "$EMPTY_FIXTURE"
echo "✅ 边界情况：sprint-prd.md 缺失时其余步骤继续"

echo ""
echo "✅ harness-report.mjs Golden Path E2E 全部通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/harness-report-script.test.js` | 模块导出、报告生成函数、patchFeatureDone 无 thickness（stale fix）| → 3 failures（模块不存在） |

> **路径说明**：TDD Red 阶段源文件位于 `sprints/06112200-report-scriptize/tests/harness-report-script.test.js`（本 sprint 目录），generator 实现脚本后将其复制/移动到 `packages/brain/src/__tests__/harness-report-script.test.js` 并通过 Green 验证。import 路径 `'../../../scripts/harness-report.mjs'` 在 `packages/brain/src/__tests__/` 下正确解析到 `packages/brain/scripts/harness-report.mjs`。
