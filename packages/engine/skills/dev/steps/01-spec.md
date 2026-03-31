---
id: dev-stage-01-spec
version: 3.6.0
created: 2026-03-20
updated: 2026-03-31
changelog:
  - 3.6.0: 新增 1.1.7 Lite 路径判断 — 5条件全满足时跳过 Planner subagent 和 Sprint Contract，主 agent 直接写 Task Card，写入 .dev-gate-lite.{branch} 和 task_track: lite
  - 3.5.0: Sprint Contract Gate Step 4 改为调用 sprint-contract-loop.sh — 脚本机械判断 blocker_count，状态写磁盘（.sprint-contract-state.{branch}），移除 prev_divergence 死循环检测，纯 while true 只有 exit 0 才退出
  - 3.4.0: Sprint Contract Gate 移除固定轮数上限（原值=3），改为死循环检测 — 连续 2 轮 divergence 列表完全相同则判定死循环，注册 P1 任务并 FAIL；否则无限收敛直到 blocker_count == 0
  - 3.3.0: Sprint Contract Gate 重写为双独立提案架构 — Generator subagent + Evaluator subagent 各自从剥离版 Task Card 独立提案，Orchestrator 比对，收敛上限为 3 轮；Planner 输出不再含任何 Test 命令
  - 3.2.0: Sprint Contract Gate PASS 后额外验证 plans.length > 0 — 若 seal 中 independent_test_plans 为空且 Task Card 含 DoD，视为 FAIL 重试
  - 3.2.0: PASS 后验证 plans.length > 0（防空提案）+ seal 文件完整性检查（伪码改为含错误处理的伪码）
  - 3.1.0: spec_review Evaluator prompt 显式内容注入 — 主 agent 在 spawn 前先读 SKILL.md + Task Card，直接嵌入 prompt，禁止传文件路径
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

## 1.1.7 Lite 路径判断（5 条件路由，CRITICAL）

> **在调用 Planner subagent 之前，先做路径判断。** 5 条件全部满足 → LITE 路径（跳过 Planner + Sprint Contract）。任意一条不满足 → FULL 路径。

### LITE 路径触发条件（ALL 5 必须为 true）

| 条件 | 说明 | 判断方式 |
|------|------|---------|
| L1 | commit type 为 fix:/docs:/chore: | 读 PRD 头部或用户说明的 commit 类型 |
| L2 | PRD 无 新增/[NEW]/[BREAKING] 关键词 | 读 PRD 全文，确认无以上关键词 |
| L3 | 预计改动文件 ≤ 3 | 主 agent 根据 PRD 评估 |
| L4 | PRD 无新 API/新路由/新数据库字段/新 schema | 读 PRD 全文，无 API/route/schema/migration 关键词 |
| L5 | 不涉及 packages/engine/hooks/ 等核心文件 | 评估改动范围 |

### LITE 路径执行（5 条件全满足）

```
1. 主 agent 直接写 Task Card（.task-cp-{branch}.md）
   - DoD 条目 Test 字段直接填写具体命令（不是 TODO）
   - Task Card 格式与 FULL 路径相同，只是由主 agent 直接完成

2. 写入 Lite seal 文件（物理凭证）：
   .dev-gate-lite.{branch} = {
     "sealed_by": "main-agent-lite-routing",
     "branch": "{branch}",
     "timestamp": "<ISO8601>",
     "routing_decision": "lite",
     "conditions": {
       "L1_commit_type": true,
       "L2_no_new_features": true,
       "L3_files_count": true,
       "L4_no_new_api": true,
       "L5_no_core_files": true
     }
   }

3. 写入 .dev-mode：
   task_track: lite

4. 直接跳至 Stage 2（跳过 Planner 调用和 Sprint Contract Gate）
```

### FULL 路径执行（任意条件不满足）

```
写入 .dev-mode：
  task_track: full

继续正常流程 → 1.2 Planner subagent → Sprint Contract Gate
```

### 伪码实现

```javascript
// 读取 PRD 内容
const PRD = readFile(`.prd-${BRANCH}.md`) || userInput

// 评估 5 条件
const L1 = /^(fix|docs|chore):/.test(commitType)
const L2 = !/(新增|\[NEW\]|\[BREAKING\])/.test(PRD)
const L3 = estimatedFileCount <= 3
const L4 = !/(新API|新路由|新数据库|新schema|new API|new route|migration)/.test(PRD)
const L5 = !/(packages\/engine\/hooks\/)/.test(PRD)

if (L1 && L2 && L3 && L4 && L5) {
  // LITE 路径
  writeFile(`.dev-gate-lite.${BRANCH}`, JSON.stringify({
    sealed_by: "main-agent-lite-routing",
    branch: BRANCH,
    timestamp: new Date().toISOString(),
    routing_decision: "lite",
    conditions: { L1_commit_type: true, L2_no_new_features: true,
                  L3_files_count: true, L4_no_new_api: true, L5_no_core_files: true }
  }))
  appendFile(`.dev-mode.${BRANCH}`, "task_track: lite\n")
  // → 主 agent 直接写 Task Card，跳过 Planner + Sprint Contract，进入 Stage 2
} else {
  // FULL 路径
  appendFile(`.dev-mode.${BRANCH}`, "task_track: full\n")
  // → 继续 1.2 Planner subagent
}
```

---

## 1.2 生成 Task Card（Planner subagent）

> **主 agent 不直接生成 Task Card。** 主 agent 是编排者，Task Card 生成由 Planner subagent 完成。
> **注意：1.1.7 LITE 路径判断后，若 task_track=lite，跳过此节，主 agent 直接写 Task Card。**
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

> **Sprint Contract 核心（v3.4 无限收敛架构）**：
> Orchestrator 将 Task Card 所有 Test 字段剥离后，分别传给 Generator subagent 和 Evaluator subagent，
> 两者各自从零独立提案，互相看不到对方输出，Orchestrator 比对两份提案，分歧时双方迭代修正，**无限收敛直到完全对齐**。
>
> **工作原理**：
> 1. Planner 产出 Task Card（所有 Test 字段为 TODO）
> 2. Orchestrator 剥离 Task Card Test 字段（保持为 TODO）→ 得到「剥离版 Task Card」
> 3. Generator subagent 独立读剥离版 → 提出 Test 方案 → 写入 `.dev-gate-generator-sprint.{BRANCH}`
> 4. Evaluator subagent（spec_review）独立读剥离版 → 提出 Test 方案 → 写入 `.dev-gate-spec.{BRANCH}`
>    （两者 **并行** 或 **串行** 均可，关键是两者输入相同且均为剥离版）
> 5. Orchestrator 比对两份提案：divergence_count = 各条目方案不一致的总数
> 6. 如有分歧 → 将 Evaluator 的提案展示给 Generator，将 Generator 的提案展示给 Evaluator → 各自修正 → 再比对
>    **无固定轮数上限**，持续迭代直到 blocker_count == 0（完全收敛）
> 7. **脚本判断（v3.5）**：Orchestrator 调用 `sprint-contract-loop.sh`，脚本机械统计 blocker_count 并写磁盘，exit 0 = 收敛，exit 1 = 继续迭代
>
> **不是软建议，而是硬门禁（exit 1）**：脚本未返回 exit 0 就不能进入 Stage 2。

### Step 1：剥离 Task Card Test 字段

```
# 剥离：将 Task Card 中所有 "Test: <非TODO内容>" 替换为 "Test: TODO"
# 目的：确保 Generator 和 Evaluator 都从零独立提案，不受已有答案污染

TASK_CARD_RAW = 读取 ".task-cp-${BRANCH}.md"
TASK_CARD_STRIPPED = TASK_CARD_RAW 中每行匹配 /Test: (?!TODO).+/ → 替换为 "Test: TODO"

# 注意：剥离版只用于传给两个 subagent，Task Card 文件本身不改动
```

### Step 2：Generator subagent 独立提案

```javascript
// 读取必要内容（内容注入原则：主 agent 先读，直接嵌入 prompt，禁止传路径）
const TASK_CARD_STRIPPED = strip_test_fields(readFile(`.task-cp-${BRANCH}.md`))
const CLAUDE_MD = readFile('.claude/CLAUDE.md')  // 编码规范供 Generator 参考

Agent({
  subagent_type: "general-purpose",
  description: "Sprint Contract Generator: 独立提案 Test 方案",
  prompt: `
你是 Sprint Contract Generator subagent。

你的任务：根据以下 Task Card（所有 Test 字段均为 TODO），为每条 DoD 条目独立设计测试方案。

## 规则
- 只看 DoD 条目描述，从零独立设计测试命令
- 测试命令必须 CI 可执行：只用 node -e / curl / tests/*.test.ts / bash
- [ARTIFACT] → node -e 文件内容断言
- [BEHAVIOR] → curl API 断言 或 node -e 行为验证
- [GATE] → node -e 文件存在或版本检查

## Task Card（剥离版）

${TASK_CARD_STRIPPED}

## 输出要求

完成后将提案写入文件 .dev-gate-generator-sprint.${BRANCH}（JSON 格式）：
{
  "sealed_by": "sprint-contract-generator",
  "branch": "${BRANCH}",
  "timestamp": "<ISO8601>",
  "proposals": [
    { "dod_item": "<条目描述前50字>", "proposed_test": "<测试命令>" }
  ]
}
`
})
```

### Step 3：Evaluator subagent（spec_review）独立提案

```javascript
// 读取 SKILL.md（内容注入原则）
const SKILL_MD = readFile('packages/workflows/skills/spec-review/SKILL.md')
const TASK_CARD_STRIPPED = strip_test_fields(readFile(`.task-cp-${BRANCH}.md`))

Agent({
  subagent_type: "general-purpose",
  description: "spec_review: Evaluator 独立提案",
  prompt: `${SKILL_MD}

---

## Sprint Contract（Task Card）— 剥离版（所有 Test 字段为 TODO）

${TASK_CARD_STRIPPED}

---

审查完成后将裁决写入 .dev-gate-spec.${BRANCH}（JSON 格式，含 independent_test_plans/verdict/issues）。
这是 Gate 防伪机制的 seal 文件，必须由你直接写入。`
})
```

### Step 4：Orchestrator 调用脚本 + 无限收敛

> **设计原则（v3.5）**：收敛判断由 `sprint-contract-loop.sh` 脚本机械执行，状态写磁盘。
> 主 agent 只负责：spawn 双方 → 调脚本 → 根据 exit code 决定继续还是重跑。
> 唯一停止条件：脚本 exit 0（blocker_count == 0）。

```bash
# Step 4 执行流程（主 agent 按此执行，while true 无轮数上限）

PROJECT_ROOT=$(pwd)
LOOP_SCRIPT="packages/engine/scripts/devgate/sprint-contract-loop.sh"

while true; do
  # 执行 Step 2（Generator subagent）和 Step 3（Evaluator subagent）
  # → 各自写 seal 文件到磁盘

  # 调用脚本做机械判断
  bash "$LOOP_SCRIPT" "$BRANCH" "$PROJECT_ROOT"
  LOOP_EXIT=$?

  if [[ $LOOP_EXIT -eq 0 ]]; then
    # ✅ 收敛：blocker_count == 0
    # 用 Evaluator seal 中 independent_test_plans 填写 Task Card Test 字段
    # 写 spec_review_status: pass → .dev-mode
    echo "spec_review_status: pass" >> ".dev-mode.${BRANCH}"
    break

  elif [[ $LOOP_EXIT -eq 2 ]]; then
    # seal 文件缺失或格式错误 → 重跑 Evaluator
    rm -f ".dev-gate-spec.${BRANCH}"
    # 继续 while loop（重新 spawn）

  else
    # exit 1：还有 blocker，脚本已输出差异详情
    # → 将差异展示给 Generator（看 Evaluator 方案）→ 覆盖 .dev-gate-generator-sprint.${BRANCH}
    # → 将差异展示给 Evaluator（看 Generator 方案）→ 覆盖 .dev-gate-spec.${BRANCH}
    # → 继续 while loop（下一轮比对）
    rm -f ".dev-gate-generator-sprint.${BRANCH}" ".dev-gate-spec.${BRANCH}"
    # 继续 while loop
  fi
done
```

**状态持久化**：
- `.sprint-contract-state.{branch}` 由脚本写入，保存 round / blocker_count / divergence 详情
- session 重启后主 agent 可读取此文件了解当前收敛进度

**执行时注意**：
- Generator 和 Evaluator subagent 的输入均为**剥离版 Task Card**（Test 字段全 TODO），机械保证独立性
- 不要传「有 Test 字段的原版 Task Card」给任何 subagent，否则破坏独立性
- Evaluator（spec_review）是最终裁判：收敛后用 Evaluator 的 independent_test_plans 填写 Task Card
- blocker_count == 0（全部 warning 或全部 consistent）也视为收敛，可以进入 Stage 2

## PASS 后验证

Sprint Contract 收敛后，在继续 Stage 2 之前确认（伪码）：

```
# 确认 seal 文件存在
如果 .dev-gate-spec.${BRANCH} 不存在：
  → 视为 Evaluator 未完成，重新执行 Step 3

如果 .dev-gate-generator-sprint.${BRANCH} 不存在：
  → 视为 Generator 未完成，重新执行 Step 2

# 确认 Task Card Test 字段已填写（不全是 TODO）
如果 Task Card 所有 Test 字段均为 TODO：
  → 视为收敛写回未完成，重新执行比对步骤

# 全部通过 → 进入 Stage 2
echo "spec_review_status: pass" >> .dev-mode.${BRANCH}
```

## 完成后

spec_review subagent 返回 PASS 且 plans.length > 0 后，**立即**执行 Stage 2：

`cat skills/dev/steps/02-code.md`
