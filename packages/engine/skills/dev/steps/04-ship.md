---
id: dev-stage-04-ship
version: 4.2.0
updated: 2026-04-16
changelog:
  - 4.2.0: F4 — 引 superpowers:finishing-a-development-branch 的 Discard 安全确认（autonomous 下不读 stdin 直接 abort + Brain task，保留安全底线）
  - 4.1.0: 新增 harness_mode 双路径 — harness 模式跳过 Learning + fire-learnings-event，非 harness 保持完整流程
  - 4.0.0: 职责分离 — 合并/cleanup_done/cleanup.sh 全部由 devloop-check 自动执行，文档只负责 Learning + 标记完成
  - 3.0.0: 精简 — 只保留 Learning + 合并 + 清理核心流程
---

# Stage 4: Ship — Learning + 标记完成

> 写 Learning 并标记 step_4_ship: done。合并和清理由 Stop Hook (devloop-check) 自动执行。

---

## 4.0 harness_mode 检测（必须先执行）

读取当前会话是否处于 harness 模式：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
harness_mode="false"
if [[ -f "$DEV_MODE_FILE" ]]; then
    _hm=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || true)
    [[ "$_hm" == "true" ]] && harness_mode="true"
fi
```

**harness_mode=true（Harness Generator 极简路径）**：
- **跳过（skip）** Learning 文件写入 — `docs/learnings/` 无需创建任何文件
- **跳过（skip）** `fire-learnings-event` 调用 — omit fire-learnings-event 在 harness 模式下不执行
- 直接跳至 **4.2 标记完成**

**harness_mode=false（正常 /dev 流程）**：
- 依次执行 **4.0.5 完工清理检查** → **4.1 写 Learning** → **4.1.5 更新系统状态** → **4.2 标记完成**
- 完整 Learning 流程：写 `docs/learnings/` 文件 + 调用 `fire-learnings-event`

---

## 4.0.5 完工清理检查（Engine 改动时必做，仅 harness_mode=false 时执行）

改动了 `packages/engine/` 下任何文件时，先运行完工检查：

```bash
bash packages/engine/skills/dev/scripts/check-cleanup.sh
```

检查内容：
- regression-contract.yaml 里的测试引用是否都存在
- Shell 脚本硬引用的路径是否存在
- 6 个版本文件是否同步

**有问题必须修复后再继续**。

---

## 4.1 写 Learning

```markdown
## <任务简述>（YYYY-MM-DD）

### 根本原因
<问题的根本原因>

### 下次预防
- [ ] <具体可执行的预防措施>
```

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
mkdir -p docs/learnings
# 写 Learning 内容到 $LEARNING_FILE

git add "$LEARNING_FILE"
git commit -m "docs: add learning for ${BRANCH_NAME}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin HEAD
```

```bash
# 触发 Brain 事件
bash skills/dev/scripts/fire-learnings-event.sh \
  --branch "$BRANCH_NAME" --pr "$PR_NUMBER" --task-id "$TASK_ID"
```

---

## 4.1.5 更新系统状态

```bash
bash scripts/write-current-state.sh
```

---

## 4.2 标记完成

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' "s/step_4_ship: pending/step_4_ship: done/" "$DEV_MODE_FILE"
# .dev-mode 不提交到 git（.gitignore 已排除），只保留在本地
# devloop-check 读取本地文件，不需要 push
git push origin HEAD
```

> 标记后 Stop Hook 自动执行：
> 1. devloop-check 条件 6 检测到 step_4_ship=done + CI passed → 自动合并 PR
> 2. 合并成功 → 执行 cleanup.sh（部署/归档/GC）
> 3. 写 cleanup_done: true → 删除 .dev-mode/.dev-lock → exit 0（会话结束）

---

## 4.3 Discard 安全确认（引 `superpowers:finishing-a-development-branch`）

官方 `finishing-a-development-branch` 提供 4 选项（merge / PR / keep / discard），其中
**discard 必须 typed-confirm** —— 防止误删 branch + commits + worktree（不可逆）。

**autonomous 模式的处理**：

- **默认不选 discard**：autonomous-research-proxy Tier 1 表固定选 "push + PR"（option 2）
- **万一走到 discard 路径**（人工调 `/dev --discard` 或其他显式选择）：
  - autonomous 模式下**不读 stdin**，直接 abort 流程
  - 创 Brain task 让人决策：`task_type=finish_branch_discard_review`
  - 不执行任何删除动作

**实现片段（Phase 1 统一后，/dev 永远不读 stdin，直接 abort + Brain task）**：

```bash
if [[ "${_FINISH_ACTION:-}" == "discard" ]]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

    echo "⚠️  This will permanently delete:"
    echo "    - Branch ${BRANCH_NAME}"
    echo "    - All commits on this branch"
    echo "    - Worktree directory"

    # /dev 默认 autonomous → aborting discard, creating Brain task for human review
    echo "/dev aborting discard, creating Brain task for human review"
    curl -s -X POST localhost:5221/api/brain/tasks \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"[discard_review] ${BRANCH_NAME}\",\"task_type\":\"finish_branch_discard_review\",\"priority\":\"P1\"}"
    exit 1
fi
```

**非 discard 路径不受影响**：merge / PR / keep 走现有 4.1-4.2 流程。
