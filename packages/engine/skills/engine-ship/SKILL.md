---
name: engine-ship
version: 16.2.0
updated: 2026-05-07
description: Cecelia /dev 接力链终棒。Superpowers finishing 完成 push+PR 后，写 Learning + 触发 Brain fire-learnings-event + 标记 step_4_ship=done。Stop Hook 接管合并 + cleanup。
trigger: Superpowers finishing-a-development-branch 完成后，按 /dev SKILL.md Phase 5 硬规则点火
---

> **CRITICAL LANGUAGE RULE**: 所有输出简体中文。

## Harness 模式检测

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
harness_mode=$(grep -m1 "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}')
[[ "$harness_mode" == "true" ]] && { echo "harness mode — 跳 Learning/fire-event，直接标 done"; skip_learning=1; }
```

harness_mode=true 时跳过 §2，直达 §3。

## 1. 完工清理检查（engine/ 有改动时必做）

```bash
bash packages/engine/skills/dev/scripts/check-cleanup.sh
```

检查 regression-contract 引用 / Shell 硬引用 / 6 个版本文件同步。有问题必修。

## 2. 写 Learning + fire Brain 事件（harness_mode=false）

格式：`## <任务简述>（YYYY-MM-DD）` + `### 根本原因` + `### 下次预防` checklist。

```bash
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
mkdir -p docs/learnings
# 写 Learning 内容到 $LEARNING_FILE
git add "$LEARNING_FILE"
git commit -m "docs: add learning for ${BRANCH_NAME}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin HEAD

bash packages/engine/skills/dev/scripts/fire-learnings-event.sh \
  --branch "$BRANCH_NAME" --pr "$PR_NUMBER" --task-id "$TASK_ID"

# 闭环回写 Brain task status=completed（CLAUDE.md §8）
bash packages/engine/skills/dev/scripts/callback-brain-task.sh \
  --branch "$BRANCH_NAME" --pr "$PR_NUMBER" --task-id "$TASK_ID"

bash scripts/write-current-state.sh
```

## 2.5 关 guardian + 写 done-marker（v23 心跳模型）

```bash
PR_NUMBER=$(gh pr view --json number -q .number 2>/dev/null || echo "")
PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
bash packages/engine/scripts/ship-finalize.sh "$BRANCH_NAME" "$PR_NUMBER" "$PR_URL" || \
  echo "[engine-ship] ship-finalize 失败但不阻塞合并（灯文件可能已被 reaper 清）"
```

## 3. 标记完成

```bash
sed -i '' "s/step_4_ship: pending/step_4_ship: done/" "$DEV_MODE_FILE"
git push origin HEAD
```

## 完成标志

- `.dev-mode` 里 `step_4_ship: done`（两模式都必须）
- harness_mode=false 时额外：`docs/learnings/<branch>.md` 存在且已 push

---

## TERMINAL IMPERATIVE

engine-ship 是 /dev 接力链终点。**退出 assistant turn，不再调 Skill**。Stop Hook 接管：CI 绿 + `step_4_ship=done` → 自动合并 PR → cleanup → exit 0；CI 红 → exit 2，退 `/superpowers:systematic-debugging`。
