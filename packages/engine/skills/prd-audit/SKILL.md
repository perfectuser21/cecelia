---
name: prd-audit
version: 1.0.0
created: 2026-03-19
updated: 2026-03-19
description: |
  PRD 覆盖审计 Skill。在 /dev Step 2 代码完成后、CI 前自动触发。
  由西安 Codex 执行，对比 Task Card 承诺 vs 实际 diff，判断功能覆盖度。
  Brain task_type=prd_coverage_audit 自动路由到此 skill。
  与 cto-review、code-quality 并行执行。
---

> **CRITICAL LANGUAGE RULE：所有输出必须使用简体中文。**

# /prd-audit — PRD 覆盖审计

## 定位

在开发流程中的位置：

```
intent-expand → 写代码 → push + PR
                                ↓
                    ┌── cto-review（架构+安全）
                    ├── code-quality（代码质量）
                    ├── prd-audit（PRD 覆盖）← 你在这里
                    └── PR review（最终审查）
                                ↓
                    全部 PASS → CI → Learning → 合并
```

**职责**：独立审计 Task Card 承诺的功能是否在代码中完整实现。
不看代码质量（code-quality 负责），不看架构（cto-review 负责），只看"说到做到"。

## 触发方式

```bash
# Brain 自动派发（无头执行）
task_type: prd_coverage_audit
# 环境变量注入
BRAIN_TASK_ID=xxx
PARENT_TASK_ID=xxx
BRAIN_URL=http://localhost:5221
```

## 执行流程

### Phase 1: 收集上下文

```bash
# 1. 读取 Task Card（PRD 承诺）
TASK_CARD=$(ls .task-cp-*.md 2>/dev/null | head -1)
cat "$TASK_CARD"

# 2. 读取 enriched PRD（如果存在）
cat .enriched-prd-*.md 2>/dev/null

# 3. 获取完整 diff（实际实现）
git diff main...HEAD

# 4. 获取变更文件列表
git diff --name-only main...HEAD
```

### Phase 2: 逐条审计

**对 Task Card 中每条成功标准和每条 DoD 条目，逐一判定覆盖状态。**

#### 三态判定标准

| 状态 | 定义 | 判定依据 |
|------|------|---------|
| **MATCH** | 代码确实实现了，diff 中有对应改动 | diff 中能找到直接对应的代码改动 |
| **DOWNGRADED** | 代码实现了，但 Test 弱于承诺 | 有实现代码，但 Test 命令验证不到核心行为 |
| **MISSING** | 代码中找不到对应实现 | diff 中完全没有相关改动 |

#### 审计方式

对每条成功标准 / DoD 条目：

1. **提取关键词**——从条目描述中提取关键函数名、文件名、API 路径
2. **搜索 diff**——在 git diff 中搜索这些关键词
3. **验证实现**——找到对应代码后，判断实现是否覆盖了条目描述的完整语义
4. **判定状态**——MATCH / DOWNGRADED / MISSING

### Phase 3: 输出结论

#### 结论格式

```
PRD_AUDIT_RESULT: PASS

覆盖详情:
1. [MATCH] 成功标准 1: "xxx" — 在 packages/brain/src/xxx.js 中实现
2. [MATCH] DoD 1: "xxx" — diff 中有对应改动
3. [MATCH] DoD 2: "xxx" — 新增文件 packages/engine/skills/xxx/SKILL.md
```

或

```
PRD_AUDIT_RESULT: FAIL

覆盖详情:
1. [MATCH] 成功标准 1: "xxx" — 已实现
2. [MISSING] 成功标准 2: "yyy" — diff 中未找到对应实现
3. [DOWNGRADED] DoD 3: "zzz" — 有实现但 Test 只检查文件存在，未验证行为

缺失项修复建议:
- 成功标准 2: 需要在 packages/xxx 中新增 yyy 功能
- DoD 3: Test 应改为 curl 或 vitest 验证运行时行为
```

#### 决定规则

| 决定 | 条件 |
|------|------|
| **PASS** | 全部 MATCH，无 MISSING |
| **FAIL** | 有任何 MISSING |
| **FAIL** | DOWNGRADED 超过 2 个 |

**少量 DOWNGRADED（≤2）不阻塞**，记录为建议改进。

### Phase 4: 回调 Brain

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# PASS 时
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{
        \"status\": \"completed\",
        \"result\": \"PASS\",
        \"review_result\": \"PRD_AUDIT_RESULT: PASS\",
        \"match_count\": 6,
        \"missing_count\": 0,
        \"downgraded_count\": 0,
        \"summary\": \"PRD 覆盖审计通过，所有承诺均已实现\"
    }" \
    "${BRAIN_URL}/api/brain/execution-callback"

# FAIL 时
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{
        \"status\": \"completed\",
        \"result\": \"FAIL\",
        \"review_result\": \"PRD_AUDIT_RESULT: FAIL\\nMISSING: 成功标准 2 未实现\",
        \"match_count\": 4,
        \"missing_count\": 1,
        \"downgraded_count\": 1,
        \"summary\": \"发现 1 项 MISSING：成功标准 2 未在代码中实现\"
    }" \
    "${BRAIN_URL}/api/brain/execution-callback"
```

## Phase 5: 写入 Evidence 文件

Brain 回调完成后，必须写 `.dev-codex-evidence.{branch}.json` 并 git push：

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
EVIDENCE_FILE=".dev-codex-evidence.${BRANCH}.json"
TASK_CARD_FILE=".task-${BRANCH}.md"
TASK_CARD_HASH="sha256:$(sha256sum "$TASK_CARD_FILE" 2>/dev/null | cut -d' ' -f1 || echo 'unknown')"
NOW=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
REVIEWER_TYPE="prd_coverage_audit"
REVIEWER_AGENT="${CODEX_AGENT_ID:-codex-local}"
BRAIN_TASK_ID_VAL="${BRAIN_TASK_ID:-unknown}"

# 构建本次 review 条目
NEW_REVIEW=$(jq -n \
  --arg rt "$REVIEWER_TYPE" \
  --arg ra "$REVIEWER_AGENT" \
  --arg bt "$BRAIN_TASK_ID_VAL" \
  --arg decision "$DECISION" \
  --arg summary "$SUMMARY" \
  --arg ts "$NOW" \
  '{reviewer_type: $rt, reviewer_agent: $ra, brain_task_id: $bt,
    decision: $decision, checks: [], summary: $summary, timestamp: $ts}')

# 创建或追加文件
if [ ! -f "$EVIDENCE_FILE" ]; then
  jq -n \
    --arg branch "$BRANCH" \
    --arg hash "$TASK_CARD_HASH" \
    --arg now "$NOW" \
    --argjson review "$NEW_REVIEW" \
    '{version:"1.0.0", branch:$branch, task_card_hash:$hash,
      created_at:$now, updated_at:$now,
      overall_decision:"PENDING", reviews:[$review]}' > "$EVIDENCE_FILE"
else
  UPDATED=$(jq --argjson review "$NEW_REVIEW" --arg now "$NOW" \
    '.reviews += [$review] | .updated_at = $now' "$EVIDENCE_FILE")
  echo "$UPDATED" > "$EVIDENCE_FILE"
fi

# 更新 overall_decision
FAIL_COUNT=$(jq '[.reviews[] | select(.decision == "FAIL")] | length' "$EVIDENCE_FILE")
PASS_COUNT=$(jq '[.reviews[] | select(.decision == "PASS" or .decision == "WARN")] | length' "$EVIDENCE_FILE")
TOTAL=$(jq '.reviews | length' "$EVIDENCE_FILE")
if [ "$FAIL_COUNT" -gt 0 ]; then
  OVERALL="FAIL"
elif [ "$TOTAL" -ge 3 ] && [ "$PASS_COUNT" -ge 3 ]; then
  OVERALL="PASS"
else
  OVERALL="PENDING"
fi
jq --arg od "$OVERALL" '.overall_decision = $od' "$EVIDENCE_FILE" > "${EVIDENCE_FILE}.tmp" && mv "${EVIDENCE_FILE}.tmp" "$EVIDENCE_FILE"

# Push 到功能分支
git add -f "$EVIDENCE_FILE"
git commit -m "chore(evidence): prd_coverage_audit=${DECISION} [${BRANCH}]"
git push origin "$BRANCH"
echo "✅ Evidence 文件已更新并 push（overall_decision=${OVERALL}）"
```

> **DECISION** 取值：`"PASS"` 或 `"FAIL"`（见 Phase 3 决定规则）
> **SUMMARY** 取值：1 句审查摘要，如 `"全部 MATCH，PRD 覆盖完整"`

## 约束

1. **只看 Task Card 中的承诺**——不发明新需求
2. **只对比 diff**——不扫全仓库，只看本次改动
3. **不评价代码质量**——那是 code-quality 的职责
4. **不评价架构**——那是 cto-review 的职责
5. **回调中 review_result 必须包含 PASS 或 FAIL 关键字**——devloop-check.sh 用 grep 检测
6. **MISSING 是硬性阻塞**——承诺了就必须实现
7. **Evidence 文件必须写入**：回调后必须写 `.dev-codex-evidence.{branch}.json` 并 git push
