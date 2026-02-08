# Step 1: PRD 确定

> 生成产品需求文档，确认后继续

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "in_progress" })`

---

## 参数检测（--task-id 支持）

**首先检查是否通过 --task-id 参数启动**：

```bash
# 1. 检查环境变量（由 Skill tool 传递）
# 注意：在 Claude Code 中，需要手动调用 parse-dev-args.sh
# 因为参数在 Skill invocation 的 args 中

# 实际使用时，Claude 会直接调用：
# bash skills/dev/scripts/parse-dev-args.sh --task-id <value>

# 如果返回值非空，说明有 task_id
```

**如果有 task_id**，自动从 Brain 读取 PRD：

```bash
task_id="<value>"  # 从 parse-dev-args.sh 获取

echo "📋 从 Brain 读取 Task: $task_id"

# 调用 fetch-task-prd.sh
if ! bash skills/dev/scripts/fetch-task-prd.sh "$task_id"; then
    echo "❌ 无法读取 Task $task_id"
    echo "可能原因："
    echo "  1. Brain 服务未运行（检查 localhost:5221）"
    echo "  2. Task ID 不存在"
    echo "  3. Task 没有 description 字段"
    exit 1
fi

# 验证生成的文件
prd_file=".prd-task-$task_id.md"
dod_file=".dod-task-$task_id.md"

if [[ ! -f "$prd_file" ]] || [[ ! -f "$dod_file" ]]; then
    echo "❌ PRD/DoD 文件生成失败"
    exit 1
fi

echo "✅ PRD 已生成: $prd_file"
echo "✅ DoD 已生成: $dod_file"

# 显示 Task 摘要
echo ""
echo "📌 Task 信息："
head -n 20 "$prd_file"

# 更新 Task 状态为 in_progress
echo ""
echo "🔄 更新 Task 状态..."
if bash skills/dev/scripts/update-task-status.sh "$task_id" "in_progress" 2>/dev/null || true; then
    echo "✅ Task 状态已更新为 in_progress"
else
    echo "⚠️  Task 状态更新失败（继续执行）"
fi

# 继续下一步（不需要用户确认）
# 跳过手动 PRD 创建流程
```

**如果没有 task_id**，走原流程（手动提供 PRD）。

---

## 入口模式

### 模式 1：--task-id（自动）

```
/dev --task-id abc-123
    ↓
自动读取 Brain Task PRD
    ↓
生成 .prd-task-abc-123.md + .dod-task-abc-123.md
    ↓
继续 Step 2
```

### 模式 2：有头入口（手动）

```
用户: "我想加一个用户登录功能"
    ↓
Claude: 生成 PRD → 继续 Step 2
```

### 模式 3：无头入口（N8N）

```json
{
  "prd": {
    "需求来源": "自动化任务",
    "功能描述": "...",
    "涉及文件": "...",
    "成功标准": "..."
  }
}
```

---

## PRD 模板

```markdown
## PRD - <功能名>

**需求来源**: <用户原话或任务来源>
**功能描述**: <我理解的功能>
**涉及文件**: <需要创建/修改的文件>
**成功标准**: <如何判断功能完成>
**非目标**: <明确说明不做什么>
```

---

## 完成条件

PRD 文件存在且包含必要字段（branch-protect.sh 会检查文件存在性）。

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "completed" })`

---

继续 → Step 2

**注意**：`.dev-mode` 文件在 Step 3 分支创建后生成。
