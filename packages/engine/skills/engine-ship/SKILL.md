---
name: engine-ship
version: 15.0.0
updated: 2026-04-19
description: Cecelia Engine /dev 接力链第 4 棒（终棒）。Superpowers finishing-a-development-branch 完成 push+PR 后，写 Learning + Brain 事件 + 标记 step_4_ship=done，让 Stop Hook 自动合并。
trigger: Superpowers finishing-a-development-branch 完成后，autonomous-research-proxy 硬规则点火
---

# Engine Ship — /dev 接力链 Step 4/4（终棒）

> **CRITICAL LANGUAGE RULE**: 所有输出必须使用简体中文。

**职责单一**：写 Learning 文件 + 触发 Brain `fire-learnings-event` + 标记 `.dev-mode` 里 `step_4_ship=done`。之后 Stop Hook (`devloop-check.sh`) 检测到 `step_4_ship=done + CI passed` → 自动合并 PR → cleanup → exit 0。

## 为什么 Superpowers 没有这个环节

Superpowers `finishing-a-development-branch` 到 push+PR 就结束了 —— 对个人开发够用。Cecelia 需要：
- Learning 文件（每个 PR 必写"根本原因 + 下次预防"，供 Brain 反思学习循环）
- `fire-learnings-event`（Brain 接口，让 cortex 吸收 Learning 到知识库）
- `step_4_ship=done` marker（驱动 Stop Hook 自动合并 + cleanup）

这三件是 Engine 独有收尾。

## 0. Harness 模式检测（harness_mode=true 走极简路径）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
harness_mode="false"
if [[ -f "$DEV_MODE_FILE" ]]; then
    _hm=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || true)
    [[ "$_hm" == "true" ]] && harness_mode="true"
fi
```

- **harness_mode=true**：跳过 Learning + fire-learnings-event，直接 §3 标记完成（Harness Evaluator 接管）
- **harness_mode=false**：走完整 §1 → §2 → §3

## 1. 完工清理检查（改了 packages/engine/ 必做）

```bash
bash packages/engine/skills/dev/scripts/check-cleanup.sh
```

检查 `regression-contract.yaml` 引用、Shell 硬引用路径、6 个版本文件同步。有问题必须修。

## 2. 写 Learning + fire Brain 事件

Learning 格式：

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

bash skills/dev/scripts/fire-learnings-event.sh \
  --branch "$BRANCH_NAME" --pr "$PR_NUMBER" --task-id "$TASK_ID"

bash scripts/write-current-state.sh
```

## 3. 标记完成

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' "s/step_4_ship: pending/step_4_ship: done/" "$DEV_MODE_FILE"
git push origin HEAD
```

> 标记后 Stop Hook 自动：
> 1. devloop-check 条件 6 检测到 step_4_ship=done + CI passed → 自动合并 PR
> 2. cleanup.sh（部署/归档/GC）
> 3. 写 cleanup_done + 删 .dev-mode/.dev-lock → exit 0

## 4. Discard 路径安全确认

若 `_FINISH_ACTION=discard` 进入此 skill（Superpowers finishing 的 discard 选项被选中）：

```bash
if [[ "${_FINISH_ACTION:-}" == "discard" ]]; then
    echo "⚠️  /dev aborting discard, creating Brain task for human review"
    curl -s -X POST localhost:5221/api/brain/tasks \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"[discard_review] ${BRANCH_NAME}\",\"task_type\":\"finish_branch_discard_review\",\"priority\":\"P1\"}"
    exit 1
fi
```

autonomous 模式不读 stdin，直接 abort + Brain task 由人决策。

## 完成标志

- Learning 文件 `docs/learnings/<branch>.md` 存在且已 push（harness_mode=false）
- `.dev-mode` 里 `step_4_ship: done`（两模式都必须）
- Stop Hook 接管后续合并

---

## TERMINAL IMPERATIVE

engine-ship 完成。你已到达 /dev 接力链终点。**你的下一个动作不是 tool call，而是**：

```
输出结束标识，退出 assistant turn。Stop Hook (devloop-check.sh) 会接管后续：
  - CI 绿 + step_4_ship=done → 自动合并 PR → cleanup → exit 0
  - CI 红 → exit 2，通知你修 CI 失败（退回 Superpowers receiving-code-review / systematic-debugging）
```

不要继续 Skill 调用。不要 Read。不要 Bash。engine-ship 是终棒。
