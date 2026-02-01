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

### 循环逻辑（模式 B：主 Agent 改）

**主 Agent 负责循环控制，最大 3 轮**：

```javascript
const MAX_GATE_ATTEMPTS = 20;
let attempts = 0;

while (attempts < MAX_GATE_ATTEMPTS) {
  // 启动独立的 gate:prd Subagent（只审核）
  const result = await Skill({
    skill: "gate:prd"
  });

  if (result.decision === "PASS") {
    // 审核通过，生成 gate 文件
    await Bash({ command: "bash scripts/gate/generate-gate-file.sh prd" });
    break;
  }

  // FAIL: 主 Agent 根据反馈修改 PRD
  for (const fix of result.requiredFixes) {
    await Edit({
      file_path: fix.location,
      old_string: "...",  // 根据 fix.issue 定位
      new_string: "..."   // 根据 fix.suggestion 修复
    });
  }

  attempts++;
}

if (attempts >= MAX_GATE_ATTEMPTS) {
  throw new Error("gate:prd 审核失败，已重试 20 次");
}
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
