---
id: dev-step-01-taskcard
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 合并原 01-prd + 05-dod 为统一 Task Card 格式
---

# Step 1: TaskCard — 开发契约定稿

> **产物**：`.task-cp-{branch}.md`（需求 + 成功标准 + DoD 条目，三合一）
> PRD 和 DoD 不再是两个文件，物理上不可能漂移。

## 1.1 参数检测

```bash
# 有 --task-id 时从 Brain 自动生成
bash skills/dev/scripts/fetch-task-prd.sh --task-id "$TASK_ID" --format task-card
```

无 task-id → 手动模式，继续 1.2。

## 1.2 生成 Task Card

创建 `.task-cp-{branch}.md`：

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
> Test 字段在 Step 2 探索后填写，现在写条目即可。

- [ ] [ARTIFACT] <条件>
  Test: TODO

- [ ] [BEHAVIOR] <条件>
  Test: TODO

- [ ] [GATE] 所有现有测试通过
  Test: manual:bash -c "npm test 2>&1 | tail -5"

## 实现方案（Step 2 探索后填写）
**要改的文件**: （探索后填写）
**Scope 锚定**: （探索后填写）
```

## 1.3 写入 .dev-mode

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
cat > ".dev-mode.${BRANCH}" << EOF
dev
branch: ${BRANCH}
task_card: .task-${BRANCH}.md
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
step_0_worktree: done
step_1_taskcard: done
step_2_code: pending
step_3_prci: pending
step_4_learning: pending
step_5_clean: pending
EOF
```

## ⛔ 自检：Task Card 格式验证（继续前必须通过）

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-${BRANCH}.md"
ERRORS=0
echo "🔍 Step 1 自检..."

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
if ! grep -qE "^- \[ \]" "$TASK_CARD" 2>/dev/null; then
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
    echo "⛔ Step 1 自检失败！修复后才能继续 Step 2。"
    exit 1
fi

echo "✅ Step 1 自检通过 — Task Card 格式正确"
```

## ⛔ CI 镜像检查（格式自检通过后、LLM Gate 前执行）

> **本地跑 CI 同款 DoD 检查脚本，让格式问题在本地被拦截，不等 CI 才发现。**

```bash
echo "🔍 本地 CI 镜像：check-dod-mapping.cjs..."

# 从 worktree 根目录运行（与 CI 完全相同的脚本）
node scripts/devgate/check-dod-mapping.cjs
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo "⛔ DoD 格式不符合 CI 要求！修复后再进 LLM Subagent。"
    echo "   常见问题："
    echo "   - [BEHAVIOR] 条目不能用 grep/ls 作为 Test 命令"
    echo "   - DoD 条目数必须 ≥ 3"
    echo "   - 必须至少有 1 个 [BEHAVIOR] 条目"
    exit 1
fi

echo "✅ CI 镜像检查通过 — DoD 格式符合要求"
```

## ⛔ LLM 质量 Gate（CI 镜像检查通过后执行）

> **bash 只能检查格式，LLM 检查质量。召唤 Verifier Subagent 评估 Task Card 是否够深。**

召唤 Verifier Subagent，prompt：

```
你是 Task Card 质量审查员。评估以下 Task Card 是否达到"可独立执行"标准。

Task Card 内容：
{粘贴 .task-cp-{branch}.md 全文}

评估 3 个维度（每项打分 1-5）：

1. DoD 可验证性：每条 DoD 条目是否有明确的 pass/fail 标准？
   5分=所有条目都有具体验证方法；1分=多数条目模糊无法验证

2. DoD 完整性：是否覆盖了错误路径、边界条件、集成点？
   5分=完整覆盖；1分=只有 happy path

3. 成功标准具体性：成功标准是否够具体，不依赖主观判断？
   5分=完全客观可测；1分=含"运行正常""功能完整"等模糊描述

输出格式：
[PASS] 或 [NEEDS_IMPROVEMENT]
评分：可验证性 X/5，完整性 X/5，具体性 X/5
改进建议（仅 NEEDS_IMPROVEMENT 时）：{具体指出哪条 DoD 需要改、怎么改}

注意：不要修改任何文件，不要写入 .dev-mode，只做评估并报告。
```

处理结果：
- **[PASS]**（三项均 ≥ 3）→ **立即写入 Gate 2 agent_seal**（双签机制），然后继续置信度自评：
  ```bash
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "step_1_agent: approved@$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)" >> ".dev-agent-seal.${BRANCH}"
  echo "✅ Gate 2 agent_seal 已写入：step_1_agent: approved"
  ```
- **[NEEDS_IMPROVEMENT]** → 按建议更新 Task Card → 重新执行 LLM 质量 Gate

## Step 1 末尾：置信度自评（写入 .dev-mode）

> **LLM 质量 Gate 通过后，AI 输出置信度自评并写入 .dev-mode。**
> 这是开始前的诚实评估，供 Step 5 执行质量对比用。

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

**输出示例**（AI 在此输出后写入）：
```
置信度：7/10
原因：PRD 清晰，但涉及 Stop Hook 循环机制有不确定性
风险：.dev-mode 格式解析的边界条件
```

## 完成后

立即执行 Step 2：`cat skills/dev/steps/02-code.md`
