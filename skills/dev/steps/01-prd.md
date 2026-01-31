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

调用 Task tool，使用以下 **完整 prompt**（必须完整复制）：

```
Task({
  subagent_type: "general-purpose",
  prompt: `你是独立的 PRD 审核员。审核以下文件：
- PRD: {prd_file}

## 审核标准

### 1. 完整性（必需字段）
- [ ] 需求来源：是否明确？（用户需求、bug报告、技术改进）
- [ ] 功能描述：是否具体？（不是"改进"、"优化"等模糊词）
- [ ] 成功标准：是否存在？
- [ ] 影响范围：是否列出涉及的文件/模块？

### 2. 可验收性（成功标准质量）
检查每条成功标准：
- [ ] 具体：描述具体行为，不是抽象概念？
- [ ] 可测：能通过测试或手动验证？
- [ ] 独立：单独可验证，不依赖其他条件？

反例（不可接受）：
- "提升用户体验" - 不可测
- "优化性能" - 没有具体指标
- "代码更优雅" - 主观判断

正例（可接受）：
- "用户点击登录按钮后，2秒内跳转到首页"
- "API 响应时间 < 200ms"
- "错误时显示'密码错误'提示"

### 3. 边界清晰度
- [ ] 有非目标字段：明确说明不做什么？
- [ ] 无歧义：不同人读 PRD 应该有相同理解？
- [ ] 范围可控：一个 PRD 对应一个 PR？

## 输出格式（必须严格遵守）

## Gate Result

Decision: PASS | FAIL

### Findings
- [PASS/FAIL] 完整性：...
- [PASS/FAIL] 可验收性：...
- [PASS/FAIL] 边界清晰度：...

### Required Fixes (if FAIL)
1. 具体修复要求 1
2. 具体修复要求 2

### Evidence
- 检查的文件：...
- 具体问题行号：...`,
  description: "gate:prd"
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
