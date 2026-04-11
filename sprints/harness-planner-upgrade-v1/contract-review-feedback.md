# Contract Review Feedback (Round 1)

**审查者**: Contract Reviewer (Evaluator)
**草案来源**: `cp-harness-propose-r1-f5ff09e7`
**PRD 来源**: `cp-04112303-harness-planner-prd`

## Triple 分析摘要

| 命令 | can_bypass | 说明 |
|------|-----------|------|
| F1 — Brain API 调用检查 | N | includes() 对 Markdown 模板充分 |
| F1 — Step 0 边界声明 | N | 正则限定了 Step 0 区块范围 |
| F2 — 6 个必需结构 | N | 全文搜索对单文件模板合理 |
| F2 — 用户交互占位符 | N | 覆盖 PRD SC-002 核心模式 |
| F3 — 9 类歧义检查 | N | 9 个特定术语同时出现足以证明 |
| F3 — ASSUMPTION 标记 | N | 直接检查，充分 |
| **F4 — OKR 对齐章节** | **Y** | **缺少"预期推进"字段检查** |
| F4 — 版本号 5.0.0 | N | 直接检查，充分 |

覆盖率: 8/8 = 100% ≥ 80% ✓

---

## 必须修改项

### 1. [命令太弱] Feature 4 — OKR 对齐章节验证命令缺少"预期推进"字段检查

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('## OKR 对齐') && !content.includes('## OKR对齐')) {
    console.error('FAIL: PRD 模板缺少 OKR 对齐章节');
    process.exit(1);
  }
  if (!content.includes('KR') || !content.includes('进度')) {
    console.error('FAIL: OKR 对齐章节缺少 KR/进度字段');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐章节完整');
"
```

**假实现片段**（proof-of-falsification）:
```markdown
## OKR 对齐

- **对应 KR**: {{从 Brain API 获取的 KR 编号}}
- **当前进度**: {{KR 当前完成百分比}}

> 如果任务与活跃 KR 对不上，在假设列表中标注。
```
上述假实现缺少"预期推进"字段，但命令只检查 `KR` 和 `进度` 两个词，不检查"预期推进"，因此仍然 PASS。这违反了 PRD 硬阈值"章节模板包含 KR 编号、当前进度、预期推进三个字段"。

**建议修复命令**:
```bash
# Feature 4 验证命令（替换原命令）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('## OKR 对齐') && !content.includes('## OKR对齐')) {
    console.error('FAIL: PRD 模板缺少 OKR 对齐章节');
    process.exit(1);
  }
  if (!content.includes('KR')) {
    console.error('FAIL: OKR 对齐章节缺少 KR 字段');
    process.exit(1);
  }
  if (!content.includes('进度')) {
    console.error('FAIL: OKR 对齐章节缺少进度字段');
    process.exit(1);
  }
  if (!content.includes('预期推进') && !content.includes('推进量') && !content.includes('预期贡献')) {
    console.error('FAIL: OKR 对齐章节缺少预期推进字段');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐章节含全部三个必需字段');
"
```

同步修复 DoD 中对应的 Test 命令：
```
- [ ] [BEHAVIOR] PRD 模板包含 `## OKR 对齐` 章节，含 KR 编号、进度、预期推进字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR 对齐')){console.error('NO OKR');process.exit(1)}if(!c.includes('KR')||!c.includes('进度')){console.error('INCOMPLETE');process.exit(1)}if(!c.includes('预期推进')&&!c.includes('推进量')&&!c.includes('预期贡献')){console.error('NO ADVANCE');process.exit(1)}console.log('PASS')"
```

---

## 可选改进

- F1 Step 0 边界声明的正则匹配了三种表述变体，可考虑加入英文变体（如 `no implementation details`），但当前 SKILL.md 全中文，不是必需的。
- F3 歧义检查可加强为验证 9 个关键词出现在同一个步骤区块内（用正则截取区块后再检查），但 9 个专有术语同时出现在无关位置的概率极低，当前已足够。
