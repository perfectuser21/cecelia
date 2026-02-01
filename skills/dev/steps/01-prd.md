# Step 1: PRD 确定

> 生成产品需求文档，gate:prd 审核通过后继续

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "in_progress" })`

---

## 入口模式

### 有头入口（默认）

```
用户: "我想加一个用户登录功能"
    ↓
Claude: 生成 PRD → gate:prd 审核 → PASS → 继续 Step 2
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

## gate:prd 审核（必须）

PRD 生成后，**必须**启动 gate:prd Subagent 审核。

### 循环逻辑

```
主 Agent 写 PRD
    ↓
启动 gate:prd Subagent
    ↓
Subagent 返回 Decision
    ↓
├─ FAIL → 主 Agent 根据 Required Fixes 修改 PRD → 再次启动 Subagent
└─ PASS → 生成 gate 文件 → 继续 Step 2
```

### Subagent 调用

调用 Skill tool 触发 gate:prd：

```
Skill({
  skill: "gate:prd"
})
```

### PASS 后操作

```bash
bash scripts/gate/generate-gate-file.sh prd
```

**Task Checkpoint**: `TaskUpdate({ taskId: "1", status: "completed" })`

---

继续 → Step 2

**注意**：`.dev-mode` 文件在 Step 3 分支创建后生成。
