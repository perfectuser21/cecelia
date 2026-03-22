---
id: dev-stage-01-spec
version: 2.2.0
created: 2026-03-20
updated: 2026-03-22
changelog:
  - 2.2.0: 删除 blocked 降级路径，改为无限重试 + 深入 root cause 分析（100% 自动原则）
  - 2.1.0: 删除降级 pass 逻辑（spec_review_degraded），3次 FAIL 改为写入 blocked 等待人工
  - 2.0.0: spec_review 改为 Agent subagent 同步调用（删除 Codex async dispatch），修复有头模式卡死
  - 1.0.0: 从 01-taskcard.md 重构为 Stage 1 Spec，加入 spec_review Codex Gate
---

# Stage 1: Spec — 读 PRD + 写 DoD + spec_review Gate

> **产物**：`.task-cp-{branch}.md`（需求 + 成功标准 + DoD 条目，三合一）
> PRD 和 DoD 不再是两个文件，物理上不可能漂移。
> **Stage 1 完成后派发 spec_review，然后停下来等 stop hook 放行。**

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
task_card: .task-${BRANCH}.md
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
TASK_CARD=".task-${BRANCH}.md"
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

## ⛔ CI 镜像检查（格式自检通过后执行）

> **本地跑 CI 同款 DoD 检查脚本，让格式问题在本地被拦截，不等 CI 才发现。**

```bash
echo "🔍 本地 CI 镜像：check-dod-mapping.cjs..."

# 从 worktree 根目录运行（与 CI 完全相同的脚本）
node packages/engine/scripts/devgate/check-dod-mapping.cjs
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo "⛔ DoD 格式不符合 CI 要求！修复后再继续。"
    echo "   常见问题："
    echo "   - [BEHAVIOR] 条目不能用 grep/ls 作为 Test 命令"
    echo "   - DoD 条目数必须 ≥ 3"
    echo "   - 必须至少有 1 个 [BEHAVIOR] 条目"
    exit 1
fi

echo "✅ CI 镜像检查通过 — DoD 格式符合要求"
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

## ⚡ 执行 spec_review Agent subagent（CRITICAL — Stage 1 最后一步）

> **Stage 1 完成后，调用 Agent subagent 同步审查 Task Card 质量。**
> subagent 在 Anthropic 服务器运行，不占本地内存，~10 秒同步完成。
> **不需要等 stop hook 放行**——subagent 是同步调用，结果立即可用。

### 重试逻辑（MUST 遵守）

- PASS → 写入 `spec_review_status: pass`，立即继续 Stage 2
- FAIL → 读取 blockers，**深入分析 root cause**，修复 Task Card，**无次数上限，继续重试**

```
retry_count = 0

loop:
  1. 调用 Agent subagent（subagent_type=general-purpose）
     - prompt = spec-review SKILL.md 全文 + Task Card 全文
     - SKILL.md 路径：packages/workflows/skills/spec-review/SKILL.md
  2. 解析 JSON 结果中的 "verdict" 字段
  3. verdict == "PASS"
       → echo "spec_review_status: pass" >> .dev-mode.${BRANCH}
       → break（继续 Stage 2）
  4. verdict == "FAIL"
       → 读取 issues[severity=="blocker"] 列表
       → 深入分析每个 blocker 的 root cause（不只看表面错误，找到根本原因）
       → 修复 Task Card（.task-${BRANCH}.md）中对应的 DoD 条目
       → retry_count++
       → 如果 retry_count > 20:
           curl -s -X POST http://localhost:5221/api/brain/tasks              -H 'Content-Type: application/json'              -d '{"title":"spec_review 超限 P1 升级","description":"spec_review 重试超过 20 次仍未 PASS，需人工介入","priority":"p1","task_type":"dev"}' || true
           break（停止重试，等待人工介入）
       → 重新调用 subagent（继续重试，直到 PASS 或 retry_count > 20）
```

**执行时注意**：
- subagent prompt 必须包含 SKILL.md **完整内容**（不能只引用路径）
- subagent prompt 必须包含 Task Card **完整内容**
- 不要向 Brain 注册任务，不要走 Codex 异步派发路径
- FAIL 修复后必须重新调用 subagent，不能跳过重审

## 完成后

spec_review subagent 返回 PASS 后，**立即**执行 Stage 2：

`cat skills/dev/steps/02-code.md`
