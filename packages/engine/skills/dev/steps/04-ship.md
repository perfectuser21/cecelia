---
id: dev-stage-04-ship
version: 1.0.0
created: 2026-03-20
changelog:
  - 1.0.0: 合并原 04-learning.md + 05-clean.md 为 Stage 4 Ship
---

# Stage 4: Ship — Learning + 合并 + Clean

> Learning 记录 + 合并 PR + 归档清理，一步到底。
> **⚠️ 顺序铁律：Learning 必须在合并 PR 之前完成。**

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "in_progress" })`

---

## 4.1 Learning — 记录经验

### 为什么必须记录？

每次开发都是一次学习机会。**不记录 = 重复踩坑。**

### 记录位置

**每个分支写自己的独立 Learning 文件**：

```
docs/learnings/<branch-name>.md
```

### 记录模板

> ⚠️ **格式严格要求**：CI `check-learning.sh` 强制检查以下三个元素，缺一不可：
> 1. `### 根本原因` 三级标题
> 2. `### 下次预防` 三级标题
> 3. `- [ ]` checklist 条目（至少一条）

```markdown
## <任务简述>（YYYY-MM-DD）

### 根本原因

<具体描述问题的根本原因>

### 下次预防

- [ ] <具体可执行的预防措施>
- [ ] <另一条具体措施>
```

### 执行方式

#### 0. 读取过程数据

```bash
INCIDENT_FILE=".dev-incident-log.json"
if [[ -f "$INCIDENT_FILE" ]]; then
    echo "=== 本次开发 Incident Log ==="
    jq -r '.[] | "[\(.step)] \(.type): \(.description)\n  错误: \(.error | split("\n")[0])\n  修复: \(.resolution)\n"' "$INCIDENT_FILE"
    CI_FAILURES=$(jq '[.[] | select(.type == "ci_failure")] | length' "$INCIDENT_FILE")
    TEST_FAILURES=$(jq '[.[] | select(.type == "test_failure")] | length' "$INCIDENT_FILE")
else
    echo "无 Incident Log（本次开发无失败记录）"
    CI_FAILURES=0
    TEST_FAILURES=0
fi
```

#### 1. 强制回答以下问题

| # | 问题 | 数据来源 |
|---|------|---------|
| Q1 | 本次 CI 失败了几次？每次的根本原因是什么？ | `.dev-incident-log.json` |
| Q2 | 本次本地验证失败了几次？ | `.dev-incident-log.json` |
| Q3 | 有没有哪个判断"以为对但后来发现是错的"？ | 回顾整个开发过程 |
| Q4 | 这些问题会不会再次出现？ | 分析根因 |
| Q5 | 有没有什么应该加入 MEMORY.md 的新踩坑？ | 判断 |

#### 2. 写 Learning

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
mkdir -p docs/learnings
# 将 Learning 内容写到 $LEARNING_FILE
```

#### 2.5 ⛔ 自检：Learning 格式验证

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
ERRORS=0

echo "🔍 Learning 格式自检..."

if [[ ! -f "$LEARNING_FILE" ]]; then
    echo "❌ Learning 文件不存在: $LEARNING_FILE"; ERRORS=1
fi
if ! grep -q "### 根本原因" "$LEARNING_FILE" 2>/dev/null; then
    echo "❌ 缺少 '### 根本原因'"; ERRORS=1
fi
if ! grep -q "### 下次预防" "$LEARNING_FILE" 2>/dev/null; then
    echo "❌ 缺少 '### 下次预防'"; ERRORS=1
fi
if ! grep -qE "^- \[ \]" "$LEARNING_FILE" 2>/dev/null; then
    echo "❌ 缺少 '- [ ]' checklist"; ERRORS=1
fi

if [[ $ERRORS -gt 0 ]]; then
    echo "⛔ Learning 格式验证失败！"; exit 1
fi
echo "✅ Learning 格式验证通过"
```

#### 2.5b ⛔ CI 镜像检查

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
export GITHUB_HEAD_REF="$BRANCH_NAME"
export PR_TITLE=$(git log --oneline -1 2>/dev/null || echo "feat: temp")

bash packages/engine/scripts/devgate/check-learning.sh
```

#### 3. 提交 Learning

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"

git add "$LEARNING_FILE"
git commit -m "docs: 记录 <任务简述> 的开发经验

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push origin HEAD
echo "✅ Learning 已推送到功能分支"
```

#### 3.5 触发 LEARNINGS_RECEIVED 事件

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
TASK_ID=$(grep "^task_id:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")

bash skills/dev/scripts/fire-learnings-event.sh \
  --branch "$BRANCH_NAME" \
  --pr "$PR_NUMBER" \
  --task-id "$TASK_ID"
```

---

## 4.2 合并 PR

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state open --json number -q '.[0].number')

gh pr merge "$PR_NUMBER" --squash --delete-branch

echo "✅ PR #$PR_NUMBER 已合并"
```

---

## 4.3 上传反馈到 Brain

```bash
task_id=$(grep "^task_id:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")

if [[ -n "$task_id" ]]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
    PR_URL=$(gh pr list --head "$BRANCH_NAME" --state merged --json url -q '.[0].url' 2>/dev/null || echo "")

    RESPONSE=$(curl -s -X POST "http://localhost:5221/api/brain/execution-callback" \
        -H "Content-Type: application/json" \
        -d "{\"task_id\":\"$task_id\",\"status\":\"completed\",\"exit_code\":0,\"pr_url\":\"$PR_URL\",\"result\":\"PR merged\"}" \
        2>/dev/null || echo "")

    if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
        echo "✅ Task $task_id 已标记为完成"
    else
        echo "⚠️  Brain 回调失败（不阻塞）"
    fi
fi
```

---

## 4.4 执行质量自评

> **在清理之前，AI 计算并输出本次任务的执行质量分。**

### 四维评分

**维度 1 — CI 效率分（1-5）**

```bash
CI_RUNS=$(gh run list --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --json conclusion --jq 'length' 2>/dev/null || echo "?")
```

| CI 运行次数 | 分数 |
|------------|------|
| 1 次通过   | 5    |
| 2 次       | 4    |
| 3 次       | 3    |
| 4 次+      | 1    |

**维度 2 — DoD 诚实度分（1-5）**
**维度 3 — 循环效率分（1-5）**
**维度 4 — Learning 质量分（1-5）**

### 输出格式

```
执行质量：X/10
- CI 效率：X/5
- DoD 诚实度：X/5
- 循环效率：X/5
- Learning 质量：X/5
可优化：{1-2句改进建议，或"无"}
```

---

## 4.5 Clean — 归档 + 清理

### Post-PR Checklist

```bash
bash scripts/post-pr-checklist.sh
```

### 归档 Task Card

```bash
mv .task-${BRANCH}.md .history/
```

### 使用 cleanup 脚本

```bash
bash skills/dev/scripts/cleanup.sh "$BRANCH_NAME" "$BASE_BRANCH"
```

### 清理任务列表

```javascript
const tasks = await TaskList()
tasks.forEach(task => {
  if (task.status !== 'completed') {
    TaskUpdate({ taskId: task.id, status: 'completed' })
  }
})
```

---

## ⛔ 自检：清理前确认

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
ERRORS=0

# 检查1: PR 已合并
PR_STATE=$(gh pr list --head "$BRANCH" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
if [[ -z "$PR_STATE" ]]; then
    echo "❌ PR 尚未合并"; ERRORS=1
fi

# 检查2: Learning 文件已存在
LEARNING_FILE="docs/learnings/${BRANCH}.md"
if [[ ! -f "$LEARNING_FILE" ]]; then
    echo "❌ Learning 文件不存在: $LEARNING_FILE"; ERRORS=1
fi

if [[ $ERRORS -gt 0 ]]; then
    echo "⛔ 自检失败！"; exit 1
fi
echo "✅ 自检通过 — 可以安全清理"
```

---

## 完成

**标记步骤完成**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"

# 标记 Stage 4 完成（最后一步）
sed -i "s/^step_4_ship: pending/step_4_ship: done/" "$DEV_MODE_FILE"
echo "✅ Stage 4 完成标记已写入 .dev-mode"

# 写入 cleanup_done: true（devloop-check.sh 的唯一终止条件）
echo "cleanup_done: true" >> "$DEV_MODE_FILE"
echo "✅ cleanup_done: true 已写入（终止条件）"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "completed" })`

```bash
echo "🎉 本轮开发完成！Stop Hook 将检测到完成条件，允许会话结束。"
```
