# Step 1: PRD 确定

> 生成产品需求文档，确认后继续

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "in_progress" })`

---

## 入口模式

### 有头入口（默认）

```
用户: "我想加一个用户登录功能"
    ↓
Claude: 生成 PRD → 继续 Step 2
```

### 无头入口（N8N）

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
