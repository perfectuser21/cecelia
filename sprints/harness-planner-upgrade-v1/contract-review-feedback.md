# Contract Review Feedback (Round 2)

## 核心问题

Round 2 修复了 5 个 Round 1 问题，其中 REVISION#5（F2-C1 限定匹配范围到执行流程之后）是正确的修复方向。但**同一修复思路未一致性地应用到其他同类命令**——F1-C2、F3-C1、F4-C1 仍然用全文 `includes()` 匹配短关键词，可被 changelog/附录/注释等非目标区域绕过。

## 必须修改项

### 1. [命令太弱] F1-C2 — 边界声明检查未限定范围到 Step 0

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('curl localhost:5221/api/brain/context')) { ... }
  if (!content.includes('不读代码实现') && !content.includes('不读实现细节') && !content.includes('不探索代码实现')) { ... }
"
```

**假实现片段**（proof-of-falsification）:
```markdown
---
version: 5.0.0
---
## Changelog
- v5.0: 不读代码实现细节（已废弃的设计原则，仅供参考）

## 执行流程
### Step 0: 上下文采集
curl localhost:5221/api/brain/context
<!-- 实际的 Step 0 没有任何边界声明 -->
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/Step\s*0[^]*?(?=Step\s*1|###\s)/i);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = step0Match[0];
  if (!step0.includes('curl localhost:5221/api/brain/context')) {
    console.error('FAIL: Step 0 缺少 Brain API 调用');
    process.exit(1);
  }
  if (!step0.includes('不读代码实现') && !step0.includes('不读实现细节') && !step0.includes('不探索代码实现')) {
    console.error('FAIL: Step 0 缺少边界声明');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含 Brain API + 边界声明');
"
```

### 2. [命令太弱] F3-C1 — 9 类歧义检查未限定匹配范围

**原始命令**:
```bash
node -e "
  const content = fs.readFileSync('...', 'utf8');
  const categories = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  let missing = categories.filter(x => !content.includes(x));
  ...
"
```

**假实现片段**（proof-of-falsification）:
```markdown
## 附录：术语表
本文涉及的领域：功能范围、数据模型、UX、非功能需求、集成点、边界、约束、术语、完成信号。
ASSUMPTION: 本文档随时可能变更。
方向性说明：无。

## 执行流程
### Step 2: 歧义自检
<!-- 实际歧义步骤为空，9 类检查完全缺失 -->
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  const categories = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  let missing = categories.filter(x => !tpl.includes(x));
  if (missing.length > 0) {
    console.error('FAIL: 执行流程区域内缺少歧义类别: ' + missing.join(', '));
    process.exit(1);
  }
  if (!tpl.includes('ASSUMPTION')) {
    console.error('FAIL: 执行流程区域内缺少 ASSUMPTION 标记');
    process.exit(1);
  }
  if (!tpl.includes('方向性')) {
    console.error('FAIL: 执行流程区域内缺少方向性决策原则');
    process.exit(1);
  }
  console.log('PASS: 执行流程区域内 9 类歧义 + ASSUMPTION + 方向性决策原则');
"
```

### 3. [命令太弱] F4-C1 — OKR 对齐章节检查用短关键词全文匹配

**原始命令**:
```bash
node -e "
  const content = fs.readFileSync('...', 'utf8');
  if (!content.includes('OKR 对齐')) { ... }
  if (!content.includes('KR') || !content.includes('进度') || !content.includes('推进')) { ... }
"
```

**假实现片段**（proof-of-falsification）:
```markdown
## Changelog
- OKR 对齐检查已更新
- KR 进度追踪改进
- 推进了 v5.0 升级

## PRD 模板
<!-- OKR 对齐章节完全缺失 -->
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  if (!tpl.includes('OKR 对齐')) {
    console.error('FAIL: 执行流程区域内缺少 OKR 对齐章节');
    process.exit(1);
  }
  if (!tpl.includes('KR') || !tpl.includes('进度') || !tpl.includes('推进')) {
    console.error('FAIL: OKR 对齐章节不完整（需要 KR + 进度 + 推进）');
    process.exit(1);
  }
  console.log('PASS: 执行流程区域内 OKR 对齐章节包含 KR/进度/推进');
"
```

## 修复模式总结

三个问题的修复模式完全一致——复用 REVISION#5 的思路：
```javascript
const idx = content.indexOf('执行流程');
const tpl = content.substring(idx);
// 在 tpl 上做 includes() 检查，而非在全文 content 上
```

F1-C2 更进一步，应限定到 Step 0 区域（`content.match(/Step\s*0[^]*?(?=Step\s*1)/i)`）。

## DoD 同步修改建议

DoD 的 Test 字段也需同步更新：
- DoD#2（Step 0 + 边界声明）→ 限定到 Step 0 区域
- DoD#4（9 类歧义 + ASSUMPTION + 方向性）→ 限定到执行流程之后
- DoD#5（OKR 对齐）→ 限定到执行流程之后

## 可选改进

- F3-C2（ASSUMPTION 标记格式）也可限定到执行流程之后，与其他命令保持一致性，但优先级低（`[ASSUMPTION:` 是足够特殊的字符串）
