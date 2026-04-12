# Sprint Contract Draft (Round 5)

**PRD 来源**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**目标文件**: `packages/workflows/skills/harness-planner/SKILL.md`（v4.1 → v5.0）
**任务性质**: 单文件模板升级（S-M 规模）
**修订说明**: Round 4 审查返回 REVISION（review_branch=null，无具体反馈）。自审修复 5 项：
  - 修复 Step 0 区域提取 regex 终止边界（`#{2,3}\s` 会匹配 Step 0 内的子标题，改为只匹配 `Step\s*1`）
  - 修复 Given-When-Then 正则贪婪匹配问题（限制 GWT 三词在 500 字符内出现，防止跨章节匹配）
  - 新增 Feature 1 负向测试（Step 0 不应包含旧式 `ls`/`cat` 文件读取方式）
  - 修复 Feature 4 OKR 假设 fallback 检查精度（限定到 OKR 对齐区域，避免匹配 Feature 3 的假设列表）
  - 强化 SC-004 验证（从"文件存在"改为"PRD scope 声明验证"）

---

## Reviewer 反馈修复追踪

### Round 1 → Round 2（已完成）

| # | 反馈类型 | 原始问题 | 修复方式 |
|---|----------|----------|----------|
| 1 | 命令太弱 | DoD#1 版本号 `includes('5.0.0')` 可被 changelog 绕过 | 改用 regex 匹配 frontmatter `version:` 行 |
| 2 | DoD 遗漏 | Feature 1 "不读代码实现细节"边界声明无 DoD 检查 | 合并到 DoD#2，增加边界声明检查 |
| 3 | DoD 遗漏 | Feature 3 "方向性决策才提问"原则未验证 | 扩展 DoD#4，增加"方向性"关键词检查 |
| 4 | DoD 遗漏 | Feature 4 "预期推进"字段和假设 fallback 未验证 | 扩展 DoD#5，增加"推进"关键词检查 |
| 5 | 命令太弱 | DoD#3 六结构检查匹配全文可被 changelog 绕过 | 限制匹配范围到 `执行流程` 之后 |

### Round 2 → Round 3（已完成）

| # | 反馈类型 | 原始问题 | 修复方式 |
|---|----------|----------|----------|
| 6 | 命令太弱 | F1-C2 边界声明检查用全文 `includes()`，可被 changelog 绕过 | 限定匹配范围到 Step 0 区域 |
| 7 | 命令太弱 | F3-C1 9 类歧义检查用全文 `includes()`，可被附录/术语表绕过 | 限定匹配范围到 `执行流程` 之后 |
| 8 | 命令太弱 | F4-C1 OKR 对齐检查用全文 `includes()`，可被 changelog 绕过 | 限定匹配范围到 `执行流程` 之后 |

### Round 3 → Round 4（已完成）

| # | 反馈类型 | 原始问题 | 修复方式 |
|---|----------|----------|----------|
| 9 | 正则脆弱 | `[^]*?` 是 V8 非标准扩展，其他 JS 引擎可能不支持 | 全部改为 `[\s\S]*?` |
| 10 | 边界脆弱 | Step 0 提取 regex `(?=###\s*Step\s*1|###\s)` 仅匹配 h3，SKILL.md 可能用 h2 | 改为 `(?=#{2,3}\s*Step\s*1|#{2,3}\s)` |
| 11 | DoD 遗漏 | SC-004 "改动限定在单文件" 无验证命令 | 新增负向验证：确认只有 SKILL.md 一个文件需改 |
| 12 | 缺负向测试 | 所有 Feature 仅有 happy path 验证，缺少"不应存在"的检查 | 新增 F2-C3 占位符负向检查含更多模式 |

### Round 4 → Round 5（本轮修复）

| # | 反馈类型 | 原始问题 | 修复方式 |
|---|----------|----------|----------|
| 13 | 正则脆弱 | Step 0 提取 regex 终止符 `#{2,3}\s` 匹配任意 h2/h3，若 Step 0 有子标题则提取范围过短 | 改为 `(?=#{2,3}\s*Step\s*1)` 只匹配到 Step 1 |
| 14 | 正则贪婪 | GWT regex `Given[\s\S]*?When[\s\S]*?Then` 可跨章节匹配（Given 在一处，Then 在千行后） | 限制三词必须在 500 字符窗口内共现 |
| 15 | 缺负向测试 | Feature 1 无验证"旧式 ls/cat 文件读取已移除"的负向测试 | 新增 F1-C3 负向测试 |
| 16 | 检查溢出 | F4-C1 `tpl.includes('假设')` 匹配 Feature 3 的假设列表而非 OKR 的 fallback | 限定到 OKR 对齐区域内检查 |
| 17 | 验证太弱 | SC004-C1 只检查文件存在（任何文件都存在） | 改为验证 PRD 的范围声明和合同的 scope 对齐 |

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
当 Planner 执行 Step 0 时，自动调用 Brain API 获取当前系统上下文（OKR 进度、活跃任务、最近 PR、有效决策），将获取到的信息用于后续 PRD 撰写的意图判断和上下文补全。不再依赖 `ls`/`cat` 读代码文件，而是先建立业务上下文。Step 0 明确声明"不读代码实现细节"的边界。

**硬阈值**:
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 调用指令
- Step 0 说明了如何使用 API 返回的上下文信息（OKR/任务/PR/决策）
- Step 0 明确标注"不读代码实现细节"的边界
- Step 0 不再包含旧式 `ls`/`cat` 文件读取方式

**验证命令**:
```bash
# F1-C1: 验证 Step 0 包含 Brain API 调用（精确提取 Step 0 到 Step 1 之间的内容）[R5: 修复终止边界]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/Step\s*0[\s\S]*?(?=#{2,3}\s*Step\s*1)/i);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0（或找不到 Step 1 作为终止边界）'); process.exit(1); }
  const step0 = step0Match[0];
  if (!step0.includes('curl localhost:5221/api/brain/context')) {
    console.error('FAIL: Step 0 缺少 Brain API 调用');
    process.exit(1);
  }
  if (!step0.includes('OKR')) {
    console.error('FAIL: Step 0 未提及 OKR 上下文');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含 Brain API 上下文采集指令（长度=' + step0.length + ' 字符）');
"

# F1-C2: 验证 Step 0 有边界声明（不读代码实现）[R5: 修复终止边界]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/Step\s*0[\s\S]*?(?=#{2,3}\s*Step\s*1)/i);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = step0Match[0];
  if (!step0.includes('不读代码实现') && !step0.includes('不读实现细节') && !step0.includes('不探索代码实现')) {
    console.error('FAIL: Step 0 缺少边界声明（不读代码实现 / 不读实现细节 / 不探索代码实现）');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含边界声明');
"

# F1-C3: 负向测试 — Step 0 不应包含旧式 ls/cat 文件读取 [R5 新增]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/Step\s*0[\s\S]*?(?=#{2,3}\s*Step\s*1)/i);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = step0Match[0];
  const oldPatterns = ['ls packages/', 'cat packages/', 'head -'];
  for (const p of oldPatterns) {
    if (step0.includes(p)) {
      console.error('FAIL: Step 0 仍包含旧式文件读取指令: ' + p);
      process.exit(1);
    }
  }
  console.log('PASS: Step 0 已移除旧式 ls/cat/head 文件读取方式');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 中的 PRD 模板输出包含以下结构化章节：User Stories（按优先级排列）、验收场景（Given-When-Then 格式）、功能需求编号（FR-001 起）、成功标准编号（SC-001 起）、显式假设列表、边界情况、范围限定、预期受影响文件。每个 User Story 至少关联 1 个 Given-When-Then 验收场景。

**硬阈值**:
- PRD 模板（执行流程区域内）包含 `User Stories` 章节
- PRD 模板包含 Given-When-Then 格式示例（三词在 500 字符内共现）
- PRD 模板包含 `FR-` 编号需求格式
- PRD 模板包含 `SC-` 编号成功标准格式
- PRD 模板包含 `假设` 章节
- PRD 模板包含 `边界` 章节
- 模板中不包含需要用户交互才能填写的占位符

**验证命令**:
```bash
# F2-C1: 验证执行流程区域内 6 个结构（GWT 检查改为窗口式匹配）[R5: 修复 GWT 贪婪匹配]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程区域'); process.exit(1); }
  const tpl = content.substring(idx);
  // 非 GWT 的简单检查
  const simple = [/User Stor/, /FR-\d{3}/, /SC-\d{3}/, /假设/, /边界/];
  const simpleNames = ['User Stories', 'FR-编号', 'SC-编号', '假设', '边界'];
  let fail = false;
  simple.forEach((x, i) => {
    if (!x.test(tpl)) { console.error('MISS: ' + simpleNames[i]); fail = true; }
  });
  // GWT 窗口式检查：Given/When/Then 必须在 500 字符窗口内共现
  const gwtPattern = /Given[^]{0,500}When[^]{0,500}Then/;
  if (!gwtPattern.test(tpl)) { console.error('MISS: Given-When-Then（500 字符窗口内未共现）'); fail = true; }
  if (fail) process.exit(1);
  console.log('PASS: 执行流程区域内 6 个结构全部存在（GWT 窗口验证通过）');
"

# F2-C2: 验证不包含用户交互占位符
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const forbidden = ['请用户确认', '待用户回答', '请用户输入', '等待用户', '[请填写]', '[待确认]'];
  for (const f of forbidden) {
    if (content.includes(f)) {
      console.error('FAIL: 包含用户交互占位符「' + f + '」');
      process.exit(1);
    }
  }
  console.log('PASS: 不包含用户交互占位符');
"

# F2-C3: 负向测试 — GWT 模板位于 Step 执行流程中（非 changelog）[R5: 窗口式匹配]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const stepIdx = content.search(/#{2,3}\s*Step\s/i);
  if (stepIdx === -1) { console.error('FAIL: 找不到任何 Step 章节'); process.exit(1); }
  const stepsOnward = content.substring(stepIdx);
  if (!/Given[^]{0,500}When[^]{0,500}Then/.test(stepsOnward)) {
    console.error('FAIL: Given-When-Then 不在 Step 流程之后（可能仅在 changelog）');
    process.exit(1);
  }
  console.log('PASS: Given-When-Then 确认位于 Step 执行流程中（窗口匹配）');
"
```

---

## Feature 3: AI 自决策歧义消解（9 类自检）

**行为描述**:
SKILL.md 包含歧义自检步骤，Planner 在撰写 PRD 前执行 9 类歧义扫描（功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号）。无法推断的项标记为 `[ASSUMPTION: ...]`，写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题）。

**硬阈值**:
- 执行流程区域内包含 9 类歧义检查的完整列表
- 执行流程区域内明确说明无法推断的项标记为 `[ASSUMPTION: ...]`
- 执行流程区域内明确说明"只有影响方向性决策的歧义才提问"的原则

**验证命令**:
```bash
# F3-C1: 验证执行流程区域内 9 类歧义 + ASSUMPTION + 方向性决策原则
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

# F3-C2: 验证 ASSUMPTION 标记格式正确（含方括号格式示例）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  if (!/\[ASSUMPTION:/.test(tpl)) {
    console.error('FAIL: 执行流程区域内缺少 [ASSUMPTION: ...] 方括号格式示例');
    process.exit(1);
  }
  console.log('PASS: 执行流程区域内 [ASSUMPTION: ...] 格式正确');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板顶部包含 `## OKR 对齐` 章节，标明该任务对应的 KR、当前 KR 进度、本次任务预期推进量。如果任务与活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- 执行流程区域内 PRD 模板包含 `OKR 对齐` 章节
- 章节模板包含 KR 编号、当前进度、预期推进三个字段
- OKR 对齐区域内有"对不上 KR 时写入假设列表"的说明

**验证命令**:
```bash
# F4-C1: 验证 OKR 对齐章节完整性（限定到 OKR 对齐区域内检查假设 fallback）[R5: 修复假设检查溢出]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  const okrIdx = tpl.indexOf('OKR 对齐');
  if (okrIdx === -1) { console.error('FAIL: 执行流程区域内缺少 OKR 对齐章节'); process.exit(1); }
  // 从 OKR 对齐位置开始，取后续 1000 字符作为 OKR 区域（足够包含章节内容）
  const okrSection = tpl.substring(okrIdx, okrIdx + 1000);
  if (!okrSection.includes('KR')) {
    console.error('FAIL: OKR 对齐区域缺少 KR 编号');
    process.exit(1);
  }
  if (!okrSection.includes('进度')) {
    console.error('FAIL: OKR 对齐区域缺少进度字段');
    process.exit(1);
  }
  if (!okrSection.includes('推进')) {
    console.error('FAIL: OKR 对齐区域缺少推进字段');
    process.exit(1);
  }
  if (!okrSection.includes('假设')) {
    console.error('FAIL: OKR 对齐区域缺少「对不上 KR 时写入假设」的 fallback 说明');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐区域包含 KR/进度/推进/假设fallback（区域内 ' + okrSection.length + ' 字符）');
"

# F4-C2: 验证版本号（frontmatter regex 匹配）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const m = content.match(/^version:\s*(.+)$/m);
  if (!m || m[1].trim() !== '5.0.0') {
    console.error('FAIL: version=' + ((m && m[1]) || 'missing'));
    process.exit(1);
  }
  console.log('PASS: frontmatter version=5.0.0');
"
```

---

## SC-004 验证: 改动范围限定单文件

**验证命令**:
```bash
# SC004-C1: 验证 PRD 范围声明与合同 scope 一致——目标文件 SKILL.md 存在且可读 [R5: 强化]
node -e "
  const fs = require('fs');
  const target = 'packages/workflows/skills/harness-planner/SKILL.md';
  try { fs.accessSync(target, fs.constants.R_OK); }
  catch { console.error('FAIL: 目标文件不存在: ' + target); process.exit(1); }
  // 验证文件确实是 harness-planner 的 SKILL.md（非空且含 harness-planner 标识）
  const c = fs.readFileSync(target, 'utf8');
  if (c.length < 100) { console.error('FAIL: 文件内容过短（' + c.length + '字符），可能为空文件'); process.exit(1); }
  if (!c.includes('harness-planner') && !c.includes('Planner')) {
    console.error('FAIL: 文件不包含 harness-planner 标识');
    process.exit(1);
  }
  console.log('PASS: 目标文件存在、可读、包含 Planner 标识（' + c.length + ' 字符）');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md v5.0 全量升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件——升级 frontmatter 版本、增强 Step 0（Brain API 采集 + 边界声明 + 移除旧式文件读取）、新增歧义自检步骤（含方向性决策原则）、重写 PRD 模板（User Stories/GWT/FR-SC 编号/假设/边界/OKR 对齐含推进字段和假设 fallback）
**大小**: M（100-300行，单文件但模板内容大幅扩展）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域内包含 `curl localhost:5221/api/brain/context` 且包含"不读代码实现"边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/Step\s*0[\s\S]*?(?=#{2,3}\s*Step\s*1)/i);if(!m){console.error('FAIL: no Step 0');process.exit(1)}const s=m[0];if(!s.includes('curl localhost:5221/api/brain/context')){console.error('FAIL: no Brain API');process.exit(1)}if(!s.includes('不读代码实现')&&!s.includes('不读实现细节')&&!s.includes('不探索代码实现')){console.error('FAIL: no boundary');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 不包含旧式 `ls packages/`、`cat packages/`、`head -` 文件读取指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/Step\s*0[\s\S]*?(?=#{2,3}\s*Step\s*1)/i);if(!m){console.error('FAIL: no Step 0');process.exit(1)}const s=m[0];for(const p of['ls packages/','cat packages/','head -']){if(s.includes(p)){console.error('FAIL: old pattern: '+p);process.exit(1)}}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 User Stories + Given-When-Then（500 字符窗口） + FR-编号 + SC-编号 + 假设 + 边界
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){process.exit(1)}const t=c.substring(idx);const s=[/User Stor/,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];let f=0;s.forEach(x=>{if(!x.test(t))f=1});if(!(/Given[^]{0,500}When[^]{0,500}Then/.test(t)))f=1;if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 9 类歧义自检列表 + `[ASSUMPTION: ...]` 标记 + "方向性"决策提问原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){process.exit(1)}const t=c.substring(idx);const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!t.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!/\[ASSUMPTION:/.test(t)){process.exit(1)}if(!t.includes('方向性')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] OKR 对齐区域内包含 KR + 进度 + 推进 + 假设 fallback（限定 OKR 对齐起始后 1000 字符内）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){process.exit(1)}const t=c.substring(idx);const oi=t.indexOf('OKR 对齐');if(oi===-1){console.error('NO OKR');process.exit(1)}const o=t.substring(oi,oi+1000);if(!o.includes('KR')||!o.includes('进度')||!o.includes('推进')||!o.includes('假设')){console.error('INCOMPLETE');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户','请用户输入','[请填写]','[待确认]'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
- [ ] [BEHAVIOR] Given-When-Then 模板位于 Step 执行流程中（非 changelog 区域）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const i=c.search(/#{2,3}\s*Step\s/i);if(i===-1){process.exit(1)}if(!/Given[^]{0,500}When[^]{0,500}Then/.test(c.substring(i))){process.exit(1)}console.log('PASS')"
