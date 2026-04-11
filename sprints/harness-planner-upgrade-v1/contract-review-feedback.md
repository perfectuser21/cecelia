# Contract Review Feedback (Round 3)

**审查结论**: REVISION
**bypass 率**: 5/10（50%，远超可接受水平）
**核心问题**: 多条命令用全文搜索代替区域隔离检查，1 条命令是无条件 PASS 空操作

---

## 必须修改项

### 1. [命令空操作] F2-C3 反向验证——无条件 PASS，完全无效

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { process.exit(0); }
  const tpl = c.substring(idx);
  console.log('PASS: 反向验证跳过（模板指令允许含代码块示例）');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：SKILL.md 的 PRD 模板中包含完整的代码实现方案（违反 PRD 只写 What 不写 How 原则）
// ## 技术实现方案
// ```javascript
// import { BrainAPI } from './brain';
// class PlannerV5 { constructor() { this.api = new BrainAPI(); } }
// ```
// F2-C3 仍然输出 PASS，因为命令根本不检查任何内容
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 无执行流程'); process.exit(1); }
  const tpl = c.substring(idx);
  // 在模板输出指令区域（非代码块示例）中检查是否包含实现方案关键词
  // 排除 markdown 代码块内的内容（那是示例）
  const noCodeBlocks = tpl.replace(/\`\`\`[\s\S]*?\`\`\`/g, '');
  const implPatterns = ['技术实现方案', '实现方案', '代码实现'];
  for (const p of implPatterns) {
    if (noCodeBlocks.includes(p)) {
      console.error('FAIL: 模板含技术实现内容: ' + p);
      process.exit(1);
    }
  }
  console.log('PASS: PRD 模板不含技术实现方案');
"
```

---

### 2. [命令太弱] F2-C1 GWT 检查——`[\s\S]{0,200}` 仍可跨行匹配，R3 修复无效

**原始命令**:
```bash
# F2-C1 中的 GWT 检查
[/Given[\s\S]{0,200}When[\s\S]{0,200}Then/, 'Given-When-Then（200字符内）']
```

**假实现片段**（proof-of-falsification）:
```markdown
<!-- SKILL.md 模板中 Given/When/Then 分散在不同章节 -->
## 假设
Given that we assume the user...

## 边界情况
When the system encounters edge cases, the behavior...

## 范围限定
Then the scope is limited to...

<!-- 三个词分布在不同章节，间隔 < 200 字符，[\s\S] 跨行匹配仍然通过 -->
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程区域'); process.exit(1); }
  const tpl = c.substring(idx);
  // 按段落拆分（双换行），检查同一段落内是否包含 Given + When + Then
  const paragraphs = tpl.split(/\n\s*\n/);
  const hasGWT = paragraphs.some(p => /Given/.test(p) && /When/.test(p) && /Then/.test(p));
  if (!hasGWT) {
    console.error('FAIL: 无同段落 Given-When-Then 场景');
    process.exit(1);
  }
  console.log('PASS: 找到同段落内 Given-When-Then 场景');
"
```

---

### 3. [命令太弱] F3-C1 歧义 9 类关键词——全文搜索未限定歧义自检区域

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const cats = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  const miss = cats.filter(x => !c.includes(x));
  ...
"
```

**假实现片段**（proof-of-falsification）:
```markdown
<!-- SKILL.md 没有歧义自检章节，但以下词散落各处 -->
## 执行流程
<!-- Step 0: 获取功能范围 -->
<!-- Step 1: 检查数据模型 -->
<!-- UX 设计模板 -->
<!-- 非功能需求: 性能 -->
<!-- 集成点: Brain API -->
## 边界情况
<!-- 约束条件 -->
<!-- 术语表 -->
<!-- 完成信号 -->
<!-- 所有 9 个词都出现了，但没有歧义自检章节 -->
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 定位歧义自检区域（应该是一个独立的 Step 或章节）
  const ambIdx = c.search(/#{1,4}\s*.*歧义/m);
  if (ambIdx === -1) { console.error('FAIL: 找不到歧义自检章节标题'); process.exit(1); }
  // 取该章节到下一个同级标题之间的内容
  const rest = c.substring(ambIdx);
  const nextSection = rest.indexOf('\n## ', 10);
  const section = nextSection > -1 ? rest.substring(0, nextSection) : rest;
  const cats = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  const miss = cats.filter(x => !section.includes(x));
  if (miss.length > 0) { console.error('FAIL: 歧义章节缺少: ' + miss.join(', ')); process.exit(1); }
  console.log('PASS: 歧义自检章节包含 9 类关键词');
"
```

---

### 4. [命令太弱] F3-C2 歧义自检存在——仅检查 `indexOf('歧义')`，无结构验证

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const ambiguityIdx = c.indexOf('歧义');
  if (ambiguityIdx === -1) { console.error('FAIL: 找不到歧义自检'); process.exit(1); }
  console.log('PASS: 歧义自检章节存在');
"
```

**假实现片段**（proof-of-falsification）:
```markdown
<!-- SKILL.md 中某处提到"歧义"这个词，但没有自检步骤 -->
## 注意事项
- 如果发现歧义，跳过即可
<!-- indexOf('歧义') 找到了，但没有自检列表 -->
```

**建议修复命令**:
```bash
# 此命令可与 issue #3 的修复合并——如果 issue #3 的修复通过（歧义章节标题 + 9 类关键词均在该章节内），本条自动被覆盖。建议删除 F3-C2 作为独立命令，并入 F3-C1 的区域化检查。
```

---

### 5. [命令太弱] F4-C1 OKR 对齐完整性——全文 `includes` 检查四个常见词

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!/#{2,3}\s*OKR 对齐/m.test(c)) { ... }
  if (!c.includes('KR')) { ... }
  if (!c.includes('进度')) { ... }
  if (!c.includes('推进')) { ... }
  if (!c.includes('假设')) { ... }
  console.log('PASS: OKR 对齐标题 + KR/进度/推进 + 假设 fallback');
"
```

**假实现片段**（proof-of-falsification）:
```markdown
<!-- SKILL.md -->
### OKR 对齐
（空章节，无任何字段模板）

<!-- 别处散落 -->
## 歧义自检
...KR 编号...当前进度...预期推进...
## 假设
...
<!-- 四个词全在文件中出现，但不在 OKR 对齐章节内 -->
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 定位 OKR 对齐章节
  const okrMatch = c.match(/#{2,3}\s*OKR 对齐/m);
  if (!okrMatch) { console.error('FAIL: 缺少 OKR 对齐标题'); process.exit(1); }
  const okrIdx = okrMatch.index;
  const rest = c.substring(okrIdx);
  // 取到下一个同级或上级标题
  const nextH = rest.search(/\n#{2,3}\s/);
  const section = nextH > 10 ? rest.substring(0, nextH) : rest;
  const required = ['KR', '进度', '推进'];
  const miss = required.filter(x => !section.includes(x));
  if (miss.length > 0) {
    console.error('FAIL: OKR 对齐章节缺少字段: ' + miss.join(', '));
    process.exit(1);
  }
  // fallback: 检查假设引用
  if (!section.includes('假设') && !section.includes('ASSUMPTION')) {
    console.error('FAIL: OKR 对齐章节缺少 KR 不匹配时的假设 fallback');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐章节含 KR/进度/推进 + 假设 fallback');
"
```

---

## DoD 联动修复建议

合同 DoD 中的 Test 命令与上述验证命令一一对应，需同步修复：

| DoD 条目 | 关联 issue | 修复要点 |
|----------|-----------|---------|
| [BEHAVIOR] Step 0 | ✓ 无问题 | — |
| [BEHAVIOR] 6 个结构 | issue #2 | GWT 改为同段落检查 |
| [BEHAVIOR] 9 类歧义 | issue #3 | 限定歧义章节区域 |
| [BEHAVIOR] OKR 对齐 | issue #5 | 限定 OKR 对齐章节区域 |
| [BEHAVIOR] 无占位符 | ✓ 无问题 | — |

---

## 可选改进

- R3 改进追踪表第 2 项声称"去掉 `s` flag，强制同段内匹配"，但实际用 `[\s\S]` 替代——`[\s\S]` 的效果与 `s` flag 完全相同（任何字符含换行）。建议在改进追踪表中修正描述，避免误导后续审查者。
- F2-C3 建议要么做成真正的反向验证，要么删除该命令——空操作命令降低合同可信度。
- F3-C2 建议合并到 F3-C1 中，减少冗余命令。
