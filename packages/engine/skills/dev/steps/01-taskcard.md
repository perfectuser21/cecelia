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

## 完成后

立即执行 Step 2：`cat skills/dev/steps/02-code.md`
