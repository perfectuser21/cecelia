---
id: dev-stage-01-spec
version: 3.0.0
created: 2026-03-20
updated: 2026-03-29
changelog:
  - 3.0.0: Task Card 生成拆为 Planner subagent — 主 agent 变纯编排者，Planner 只接收任务描述 + SYSTEM_MAP
  - 2.4.0: spec_review 升级为 Sprint Contract Gate — subagent 独立写测试方案后与主 agent 比对，严重分歧 = 硬 FAIL，不能继续 Stage 2
  - 2.3.0: spec_review 新增测试层（test layer）检查指令：每个 DoD 条目必须对应合适的测试类型
  - 2.2.0: 删除 blocked 降级路径，改为无限重试 + 深入 root cause 分析（100% 自动原则）
  - 2.1.0: 删除降级 pass 逻辑（spec_review_degraded），3次 FAIL 改为写入 blocked 等待人工
  - 2.0.0: spec_review 改为 Agent subagent 同步调用（删除 Codex async dispatch），修复有头模式卡死
  - 1.0.0: 从 01-taskcard.md 重构为 Stage 1 Spec，加入 spec_review Codex Gate
---

# Stage 1: Spec — 读 PRD + 写 DoD + spec_review Gate

> **产物**：`.task-cp-{branch}.md`（需求 + 成功标准 + DoD 条目，三合一）
> PRD 和 DoD 不再是两个文件，物理上不可能漂移。
> **Stage 1 完成后，调用 spec_review Agent subagent 执行 Sprint Contract Gate — subagent 独立生成测试方案后与主 agent 比对，达成共识才能继续 Stage 2。**

## 1.1 参数检测

```bash
# 有 --task-id 时从 Brain 自动生成
bash skills/dev/scripts/fetch-task-prd.sh --task-id "$TASK_ID" --format task-card
```

无 task-id → 手动模式，继续 1.2。

## 1.1.5 上下文补充（intent-expand）

> 从 Brain 读取当前任务关联的 KR/Initiative/Project 信息，补充到 PRD。
> 确保 Agent 知道"这个任务是为了什么更大的目标"。

如果有 --task-id，从 Brain API 读取上下文：

```bash
BRAIN_URL="${BRAIN_API_URL:-http://localhost:5221}"
TASK_INFO=$(curl -s "$BRAIN_URL/api/brain/tasks/$TASK_ID" 2>/dev/null)
GOAL_ID=$(echo "$TASK_INFO" | jq -r '.goal_id // empty')
PROJECT_ID=$(echo "$TASK_INFO" | jq -r '.project_id // empty')

if [[ -n "$GOAL_ID" ]]; then
    GOAL_INFO=$(curl -s "$BRAIN_URL/api/brain/goals/$GOAL_ID" 2>/dev/null)
    KR_TITLE=$(echo "$GOAL_INFO" | jq -r '.title // "unknown"')
    echo "📍 此任务关联 KR: $KR_TITLE"
    echo "goal_id: $GOAL_ID" >> "$DEV_MODE_FILE"
fi
if [[ -n "$PROJECT_ID" ]]; then
    echo "project_id: $PROJECT_ID" >> "$DEV_MODE_FILE"
fi
```

将 KR 标题和描述注入到 Task Card 的"背景"部分。

## 1.2 生成 Task Card（Planner subagent）

> **主 agent 不直接生成 Task Card。** 主 agent 是编排者，Task Card 生成由 Planner subagent 完成。
> Planner subagent 只接收：任务描述（PRD/task description）+ docs/current/SYSTEM_MAP.md 全文。
> 不接收：CLAUDE.md（编码规范）、Brain context（调度上下文）、代码库细节。
> Planner 只输出 WHAT（行为描述），不写 HOW（实现细节）。

### 架构

```
主 agent（编排者）
  ├─ 1.1 参数检测
  ├─ 1.1.5 上下文补充（intent-expand）
  ├─ 1.2 生成 Task Card → spawn Planner subagent ← 你在这里
  ├─ 1.3.5 相关 Learning 检索
  ├─ 1.3 写入 .dev-mode
  └─ Sprint Contract Gate（spec_review subagent）
```

### Planner subagent 调用

```
1. 准备 prompt 输入（仅以下两项，禁止传入其他内容）：
   a. 任务描述（PRD 全文，或用户提供的 task description）
   b. docs/current/SYSTEM_MAP.md 全文 — 系统能力地图

   禁止传入：
   - CLAUDE.md（编码规范）
   - Brain API 返回的调度上下文（OKR/KR/Project 层级信息）
   - 代码库细节（文件路径、函数签名、实现代码）
   - 其他 subagent 的审查结果

2. 调用 Agent subagent（subagent_type=general-purpose）
   prompt 模板见 packages/engine/skills/dev/lib/planner-prompt.md

3. Planner 完成后，主 agent 接收 Task Card 内容，写入 .task-cp-{branch}.md
4. 主 agent 继续 1.3.5 Learning 检索 → 1.3 写入 .dev-mode → Sprint Contract Gate
```

### 主 agent 调用代码（伪码）

```javascript
// 1. 读取任务描述和 SYSTEM_MAP
const PRD = readFile('.prd-{branch}.md') || userInput
const SYSTEM_MAP = readFile('docs/current/SYSTEM_MAP.md')
const PLANNER_PROMPT = readFile('packages/engine/skills/dev/lib/planner-prompt.md')

// 2. 组装 prompt（只含任务描述 + SYSTEM_MAP）
const prompt = PLANNER_PROMPT
  .replace('{PRD_CONTENT}', PRD)
  .replace('{SYSTEM_MAP_CONTENT}', SYSTEM_MAP)

// 3. 调用 Planner subagent
Agent({
  subagent_type: "general-purpose",
  description: "Planner: 生成 Task Card + DoD",
  prompt: prompt
})

// 4. Planner 将 Task Card 写入 .task-cp-{branch}.md
// 5. 主 agent 继续 Sprint Contract Gate
```

### ⚠️ Planner subagent 隔离规则（CRITICAL）

| 允许传入 | 禁止传入 |
|---------|---------|
| 任务描述（PRD/用户 input） | CLAUDE.md（编码规范） |
| docs/current/SYSTEM_MAP.md | Brain 调度上下文 |
| | OKR/KR/Project 层级信息 |
| | 代码库文件路径 / 实现细节 |
| | 其他 subagent 审查结果 |

**为什么隔离**：Planner 只需要知道"要做什么"（任务描述）和"系统有什么"（SYSTEM_MAP），不需要知道"怎么写代码"。隔离编码上下文，确保需求描述不受实现偏见污染。

### Task Card 输出格式

Planner 写入 `.task-cp-{branch}.md`：

```markdown
---
id: task-cp-MMDDHHNN-xxx
type: task-card
branch: cp-MMDDHHNN-xxx
created: YYYY-MM-DD
---

# Task Card: <功能名>

## 需求（What & Why）
**功能描述**: ...
**背景**: ...
**不做什么**: ...

## 成功标准
> [ARTIFACT] 产出物 / [BEHAVIOR] 运行时行为 / [GATE] 门禁

1. [ARTIFACT] ...
2. [BEHAVIOR] ...
3. [GATE] CI 全部通过

## 验收条件（DoD）
> Test 字段在 Stage 2 探索后填写，现在写条目即可。
> **[PRESERVE] 条目**：修改已有文件时必须填写，Step 2.0 强制门禁会检查。

- [ ] [PRESERVE] <涉及模块的现有关键行为>
  Test: TODO

- [ ] [ARTIFACT] <条件>
  Test: TODO

- [ ] [BEHAVIOR] <条件>
  Test: TODO

- [ ] [GATE] 所有现有测试通过
  Test: manual:npm test

## 实现方案（Stage 2 探索后填写）
**要改的文件**: （探索后填写）
**Scope 锚定**: （探索后填写）
```

## 1.3.5 相关 Learning 检索

> 查找跟当前任务相关的历史 Learning，推荐给 Agent 避免重复踩坑。

```bash
# 从 task title/description 提取关键词，搜索 docs/learnings/
KEYWORDS=$(echo "$TASK_TITLE" | tr ' ' '\n' | grep -v '^$' | head -5)
RELATED_LEARNINGS=""
for kw in $KEYWORDS; do
    FOUND=$(grep -rl "$kw" docs/learnings/ 2>/dev/null | head -3)
    [[ -n "$FOUND" ]] && RELATED_LEARNINGS="$RELATED_LEARNINGS $FOUND"
done

if [[ -n "$RELATED_LEARNINGS" ]]; then
    echo "📚 相关 Learning（建议阅读）："
    for f in $(echo "$RELATED_LEARNINGS" | tr ' ' '\n' | sort -u | head -5); do
        echo "  - $f"
    done
fi
```

## 1.3 写入 .dev-mode

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
cat > ".dev-mode.${BRANCH}" << EOF
dev
branch: ${BRANCH}
task_card: .task-cp-${BRANCH}.md
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
step_0_worktree: done
step_1_spec: done
step_2_code: pending
step_3_integrate: pending
step_4_ship: pending
EOF
```

## ⛔ 自检：Task Card 格式验证（继续前必须通过）

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-cp-${BRANCH}.md"
ERRORS=0
echo "🔍 Stage 1 自检..."

# 检查1: Task Card 文件存在
if [[ ! -f "$TASK_CARD" ]]; then
    echo "❌ Task Card 不存在: $TASK_CARD"
    ERRORS=1
fi

# 检查2: 包含成功标准
if ! grep -q "## 成功标准" "$TASK_CARD" 2>/dev/null; then
    echo "❌ 缺少 '## 成功标准' 章节"
    ERRORS=1
fi

# 检查3: 包含 DoD checklist
if ! grep -qE "^\s*-\s*\[\s*\]" "$TASK_CARD" 2>/dev/null; then
    echo "❌ 缺少 DoD checklist（- [ ] 条目）"
    ERRORS=1
fi

# 检查4: 包含 Test 字段（不能全是 TODO）
if ! grep -q "Test: manual:\|Test: contract:\|Test: tests/" "$TASK_CARD" 2>/dev/null; then
    echo "❌ DoD 条目缺少 Test 字段（Test: manual:bash... 等）"
    ERRORS=1
fi

# 检查5: .dev-mode 文件已创建
if [[ ! -f ".dev-mode.${BRANCH}" ]]; then
    echo "❌ .dev-mode.${BRANCH} 未创建"
    ERRORS=1
fi

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo "⛔ Stage 1 自检失败！修复后才能继续。"
    exit 1
fi

echo "✅ Stage 1 自检通过 — Task Card 格式正确"
```

## ⛔ CI 镜像检查：PRD 成功标准格式验证

> **本地跑 check-prd.sh，拦截"成功标准少于2条 bullet"问题，不等 CI L1 才发现。**

```bash
echo "🔍 本地 CI 镜像：check-prd.sh..."
bash packages/engine/scripts/devgate/check-prd.sh
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo "⛔ PRD 格式不符合 CI 要求！修复后再继续。"
    echo "   要求：## 成功标准 章节下至少 2 条 bullet（- 或 * 开头）"
    exit 1
fi

echo "✅ PRD 格式检查通过 — 成功标准 ≥ 2 条"
```

## Stage 1 末尾：置信度自评（写入 .dev-mode）

> **CI 镜像检查通过后，AI 输出置信度自评并写入 .dev-mode。**
> 这是开始前的诚实评估，供 Stage 4 执行质量对比用。

AI 自评后，执行以下写入：

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH}"

# AI 根据以下评分指南，填写三个值：
CONFIDENCE_SCORE=X    # 1-10 整数
CONFIDENCE_REASON="..." # 1-2句，说明打分原因
CONFIDENCE_RISK="..."   # 主要不确定因素（没有风险写"无"）

cat >> "$DEV_MODE_FILE" << EOF
confidence_score: ${CONFIDENCE_SCORE}
confidence_reason: ${CONFIDENCE_REASON}
confidence_risk: ${CONFIDENCE_RISK}
EOF
echo "✅ 置信度已写入 .dev-mode"
```

**评分指南**：

| 分数 | 含义 |
|------|------|
| 9-10 | PRD 清晰，改动简单，接口熟悉，无不确定性 |
| 7-8  | PRD 清晰，有小的不确定因素或边界条件 |
| 5-6  | PRD 有模糊点，或涉及复杂逻辑 / 不熟悉模块 |
| 3-4  | PRD 不够清晰，多处不确定，需要大量探索 |
| 1-2  | 需求很模糊，改动范围不确定，高度不确定 |

## ⚡ Sprint Contract Gate（CRITICAL — Stage 1 最后一步，硬门禁）

> **Sprint Contract 核心**：Generator（主 agent）和 Evaluator（spec_review subagent）必须对每条 DoD 的测试方案达成共识，才能开始写代码。
>
> **工作原理**：
> 1. 主 agent 草拟 DoD（含 Test 字段）
> 2. spec_review subagent 独立为每条 DoD 生成测试方案（不看主 agent 的 Test 字段）
> 3. 比对：双方测试方案是否验证同一件事？
>    - 一致 → 采信主 agent 的 Test 字段，继续
>    - 严重分歧 → FAIL，打回重写，无限重试直到一致
>
> **不是软建议，而是硬门禁（exit 1）**：有严重分歧就不能进入 Stage 2。

### 重试逻辑（MUST 遵守）

- PASS → 写入 `spec_review_status: pass`，立即继续 Stage 2
- FAIL → 读取 issues（包括 Sprint Contract 分歧），**深入分析 root cause**，修复 Task Card，**无次数上限，继续重试**

```
retry_count = 0

loop:
  1. 调用 Agent subagent（subagent_type=general-purpose）
     - prompt = spec-review SKILL.md 全文 + Task Card 全文
     - SKILL.md 路径：packages/workflows/skills/spec-review/SKILL.md
     - **CRITICAL**: prompt 必须包含以下指令（seal 文件写入）：
         "审查完成后，将你的裁决以 JSON 格式写入文件 .dev-gate-spec.<BRANCH>：
          { \"verdict\": \"PASS\"|\"FAIL\", \"branch\": \"<BRANCH>\",
            \"timestamp\": \"<ISO8601>\", \"reviewer\": \"spec-review-agent\",
            \"independent_test_plans\": [...],
            \"negotiation_result\": {...},
            \"issues\": [...] }
          这是 Gate 防伪机制的 seal 文件，必须由你（subagent）直接写入。"
     - **Sprint Contract 比对（v2.4.0 新增，硬门禁）**：
         * 对每个 DoD 条目，先独立设计测试方案（不看主 agent 的 Test 字段）
         * 然后比对主 agent 的 Test 字段：
           - 一致 → consistent: true
           - 严重分歧（主 agent 测试的是另一件事，或是假测试）→ consistent: false，severity: blocker
           - 轻微分歧（测试层不匹配但能验证核心行为）→ consistent: false，severity: warning
         * 严重分歧 = 整体 FAIL（exit 1），不能进入 Stage 2
     - **测试层检查（v2.3.0）**：审查时验证每个 DoD 条目的测试类型是否合适：
         * [ARTIFACT] 类条目 → 推荐 unit 级测试（node -e 文件内容验证）
         * [BEHAVIOR] 类条目 → 推荐 integration 级测试（curl/API 行为验证 + 断言）
         * [GATE] CI 类条目 → 推荐 e2e 级测试（CI 运行 / 语法检查）
  2. 解析 JSON 结果中的 "verdict" 字段
  3. verdict == "PASS"
       → 确认 seal 文件 .dev-gate-spec.${BRANCH} 已存在（由 subagent 写入）
       → echo "spec_review_status: pass" >> .dev-mode.${BRANCH}
       → break（继续 Stage 2）
  4. verdict == "FAIL"
       → 读取 issues 列表（包括 severity=="blocker" 和 sprint_contract 分歧）
       → 深入分析每个 blocker 的 root cause：
         - 如果是 Sprint Contract 分歧：找到主 agent Test 字段未能覆盖的核心断言，重写该 Test 字段
         - 如果是维度 D/E blocker：修复 Test 命令格式或工具
         - 如果是维度 A/B blocker：修复架构方向或 DoD 描述
       → 修复 Task Card（.task-cp-${BRANCH}.md）中对应的 DoD 条目
       → retry_count++
       → 如果 retry_count > 20:
           curl -s -X POST http://localhost:5221/api/brain/tasks \
             -H 'Content-Type: application/json' \
             -d '{"title":"spec_review 超限 P1 升级","description":"spec_review 重试超过 20 次仍未 PASS，需人工介入","priority":"p1","task_type":"dev"}' || true
           break（停止重试，等待人工介入）
       → 重新调用 subagent（继续重试，直到 PASS 或 retry_count > 20）
```

**执行时注意**：
- subagent prompt 必须包含 SKILL.md **完整内容**（不能只引用路径）
- subagent prompt 必须包含 Task Card **完整内容**
- **CRITICAL**: subagent prompt 必须包含 seal 文件写入指令（`.dev-gate-spec.<BRANCH>`），seal 文件必须包含 `independent_test_plans` 字段
- 不要向 Brain 注册任务，不要走 Codex 异步派发路径
- Sprint Contract 分歧导致的 FAIL，修复方向是重写 **Test 字段**（不是修改 DoD 描述），直到与 subagent 独立方案一致
- FAIL 修复后必须重新调用 subagent，不能跳过重审

## 完成后

spec_review subagent 返回 PASS 后，**立即**执行 Stage 2：

`cat skills/dev/steps/02-code.md`
