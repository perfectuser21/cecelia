---
id: dev-stage-04-ship
version: 3.0.0
updated: 2026-04-02
changelog:
  - 3.0.0: 精简 — 只保留 Learning + 合并 + 清理核心流程
---

# Stage 4: Ship — Learning + 合并 + 清理

> Learning 必须在合并 PR 之前完成。

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "in_progress" })`

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

## 4.2 合并 PR

```bash
gh pr merge <PR_NUMBER> --squash
```

---

## 4.3 清理 + 标记完成

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' "s/step_4_ship: pending/step_4_ship: done/" "$DEV_MODE_FILE"
echo "cleanup_done: true" >> "$DEV_MODE_FILE"

bash skills/dev/scripts/cleanup.sh "$BRANCH_NAME" "main"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "completed" })`
