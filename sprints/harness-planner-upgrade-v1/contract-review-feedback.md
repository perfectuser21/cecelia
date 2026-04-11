# Contract Review Feedback (Round 2)

## 必须修改项

### 1. [命令太弱] Feature 4 — `includes('KR')` 被 `OKR` 子串永远满足

**原始命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  if(!c.includes('KR')||!c.includes('进度')||!c.includes('推进')){...}
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：OKR 对齐章节为空壳，但全文 includes 检查仍通过
const fakeSkill = `
version: 5.0.0
# Harness Planner
## 执行流程
Step 0: 调用 Brain API 获取 OKR 进度、活跃任务...
## OKR 对齐
（此处无任何字段模板定义）
本次升级推进 Cecelia 系统演进
`;
// includes('OKR 对齐') → true
// includes('KR') → true（'OKR' 包含 'KR'）
// includes('进度') → true（'OKR 进度' 在 Step 0）
// includes('推进') → true（'推进' 在最后一行）
// 结果：PASS — 但 OKR 对齐章节没有 KR 编号/进度/推进三个独立字段
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const idx=c.indexOf('## OKR 对齐');
  if(idx===-1){console.error('FAIL: 缺少 ## OKR 对齐');process.exit(1)}
  const nextH2=c.indexOf('\n## ',idx+5);
  const sec=c.substring(idx,nextH2>0?nextH2:c.length);
  if(!/KR[\s-]/.test(sec)){console.error('FAIL: OKR 对齐章节内无独立 KR 字段');process.exit(1)}
  if(!sec.includes('进度')){console.error('FAIL: OKR 对齐章节内无进度字段');process.exit(1)}
  if(!sec.includes('推进')){console.error('FAIL: OKR 对齐章节内无推进字段');process.exit(1)}
  console.log('PASS: OKR 对齐章节含 KR + 进度 + 推进');
"
```

### 2. [命令太弱] Feature 2 — `/假设/` 和 `/边界/` 正则匹配过宽，可被歧义自检描述满足

**原始命令**:
```bash
# F2-C1 中的检查
const checks = [
  ['假设章节', /假设/],
  ['边界情况章节', /边界/]
];
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：PRD 模板中没有 ## 假设列表 和 ## 边界情况 章节
// 但歧义自检步骤（也在执行流程区域内）包含：
//   "6. 边界情况 → 列出常见边界并标注为假设"
// 这一行同时满足 /假设/ 和 /边界/
const fakeTemplate = `
## 执行流程
### Step 2: 歧义自检
6. 边界情况 → 列出常见边界并标注为假设
### Step 3: 撰写 PRD
## User Stories
...
（无 ## 假设列表 章节）
（无 ## 边界情况 章节）
`;
// /假设/.test(tpl) → true（匹配 "标注为假设"）
// /边界/.test(tpl) → true（匹配 "边界情况 →"）
// 结果：PASS — 但 PRD 模板实际没有这两个独立章节
```

**建议修复命令**:
```bash
# 将 F2-C1 的假设和边界检查改为匹配章节标题格式
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  const checks = [
    ['User Stories', /User Stor(y|ies)/],
    ['Given-When-Then', /Given.*When.*Then/s],
    ['FR- 编号', /FR-\d{3}/],
    ['SC- 编号', /SC-\d{3}/],
    ['假设章节', /##\s*(显式)?假设/],
    ['边界情况章节', /##\s*边界(情况)?/]
  ];
  let fail = false;
  for (const [name, re] of checks) {
    if (!re.test(tpl)) {
      console.error('FAIL: 执行流程区缺少 ' + name);
      fail = true;
    }
  }
  if (fail) process.exit(1);
  console.log('PASS: PRD 模板包含全部 6 个必需结构');
"
```

### 3. [PRD 遗漏] Feature 4 — 缺少"对不上 KR → 写入假设列表"的 fallback 验证

**原始命令**: F4-C1 只验证 OKR 对齐章节存在 + 三字段，未验证 fallback 行为

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：OKR 对齐章节有三字段但没有 fallback 说明
const fakeOkrSection = `
## OKR 对齐
- 对应 KR: KR-xxx
- 当前进度: xx%
- 预期推进: xx%
（缺少：如果对不上 KR 怎么办的说明）
`;
// 通过所有现有检查，但 PRD 明确要求：
// "如果任务描述与任何活跃 KR 对不上，在假设列表中标注"
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');
  const idx=c.indexOf('## OKR 对齐');
  if(idx===-1){console.error('FAIL: 缺少 OKR 对齐');process.exit(1)}
  const nextH2=c.indexOf('\n## ',idx+5);
  const sec=c.substring(idx,nextH2>0?nextH2:c.length);
  if(!sec.includes('假设')){console.error('FAIL: OKR 对齐缺少对不上 KR 时写入假设的 fallback');process.exit(1)}
  console.log('PASS');
"
```

### 4. [PRD 遗漏] Feature 2 — 缺少"范围限定"章节的验证命令

**原始命令**: F2-C1 检查 6 个结构，但遗漏了 PRD Feature 2 明确列出的"范围限定（在范围/不在范围）"

**假实现片段**（proof-of-falsification）:
```javascript
// PRD Feature 2 系统响应明确列出 8 个章节：
// User Stories、验收场景、功能需求编号、成功标准编号、
// 显式假设列表、边界情况、范围限定、预期受影响文件
// 但 F2-C1 只检查前 6 个，遗漏了"范围限定"和"预期受影响文件"
// 范围限定是 PRD 质量的关键要素（区分在范围/不在范围）
```

**建议修复命令**:
```bash
# 在 F2-C1 的 checks 数组中追加：
['范围限定', /范围/],     // 匹配 "在范围" 或 "不在范围" 或 "范围限定"
```

## 可选改进

- **DoD Test 命令与 Feature 验证命令高度重复**（DoD #2-#6 与 F1-F4 逻辑相同）。建议 DoD 直接引用 Feature 命令编号，或合并为一组，避免维护两份同步问题。
- Feature 2 的 `/Given.*When.*Then/s` 用了 `s` flag 允许跨行匹配，理论上"Given"在第 1 行"Then"在第 200 行也能通过。对于模板文件风险可接受，但如需更严格可限制为同一段落内匹配。
