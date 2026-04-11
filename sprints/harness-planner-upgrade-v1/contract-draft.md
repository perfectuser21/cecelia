# Sprint Contract Draft (Round 6)

**PRD 来源**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**目标文件**: `packages/workflows/skills/harness-planner/SKILL.md`（v4.1 → v5.0）
**任务性质**: 单文件模板升级（S-M 规模）
**修订说明**: 基于 R5 合同 + 已 APPROVED 的 R3 合同结构，统一验证策略：全部采用区域隔离检查（Step 0 区域、执行流程区域），验证命令简洁可靠

---

## R5→R6 改进追踪

| # | R5 问题 | R6 修复方式 |
|---|---------|------------|
| 1 | R5 验证命令过度复杂（多层标题级别动态计算），可维护性差 | 采用 APPROVED R3 的简洁策略：Step 0 用 `Step 0...Step 1` 区域，其余用 `执行流程` 后全文 |
| 2 | DoD Test 命令过长（单行 >300 字符），不易调试 | 精简到核心断言，减少嵌套 |
| 3 | F2-C3 反向验证排除代码块逻辑复杂 | 简化为直接检查模板不含 `技术实现方案`/`实现方案`/`代码实现` 关键词（排除代码块内容） |

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
Planner 执行 Step 0 时，自动调用 Brain API（`/api/brain/context`、`/api/brain/tasks`、`/api/brain/decisions`）获取 OKR 进度、活跃任务、最近 PR、有效决策。采集结果用于 PRD 各章节的意图判断和上下文补全。Step 0 明确声明"不读代码实现细节"的边界。

**硬阈值**:
- SKILL.md 的 Step 0 区域（从 `Step 0` 到 `Step 1` 之间）包含 `curl localhost:5221/api/brain/context` 命令
- Step 0 区域包含 `/api/brain/tasks` 端点引用
- Step 0 区域包含 `/api/brain/decisions` 端点引用
- Step 0 区域包含边界声明（不读代码实现）

**验证命令**:
```bash
# F1-C1 Happy path: Step 0 区域包含 Brain API 三端点
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const m = c.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);
  if (!m) { console.error('FAIL: 找不到 Step 0 区域'); process.exit(1); }
  const s = m[0];
  const apis = ['/api/brain/context', '/api/brain/tasks', '/api/brain/decisions'];
  const miss = apis.filter(a => !s.includes(a));
  if (miss.length) { console.error('FAIL: Step 0 缺少 ' + miss.join(', ')); process.exit(1); }
  console.log('PASS: Step 0 包含 Brain API 三端点');
"

# F1-C2 边界验证: Step 0 区域包含边界声明
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const m = c.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);
  if (!m) { console.error('FAIL: 找不到 Step 0 区域'); process.exit(1); }
  const s = m[0];
  const b = ['不读代码实现', '不读实现细节', '不探索代码实现', '不读代码'];
  if (!b.some(p => s.includes(p))) {
    console.error('FAIL: Step 0 缺少边界声明');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含边界声明');
"

# F1-C3 反向验证: 不包含用户交互占位符
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const bad = ['请用户确认', '等待用户', '问用户', '请确认', '[请填写]', '{用户输入}'];
  const found = bad.filter(f => c.includes(f));
  if (found.length) { console.error('FAIL: 包含占位符: ' + found.join(', ')); process.exit(1); }
  console.log('PASS: 无人工交互占位符');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 中的 PRD 模板包含以下结构化章节：User Stories（含同段落 Given-When-Then 验收场景）、编号功能需求（FR-xxx）、编号成功标准（SC-xxx）、显式假设列表、边界情况章节。模板中所有字段由 AI 自动填写，不包含技术实现方案。

**硬阈值**:
- 执行流程区域内包含 `User Stories` 章节
- 执行流程区域内包含同段落 `Given` + `When` + `Then`（按双换行拆段检查）
- 执行流程区域内包含 `FR-` 编号格式
- 执行流程区域内包含 `SC-` 编号格式
- 执行流程区域内包含假设章节标题（`假设` 或 `显式假设`）
- 执行流程区域内包含边界情况章节标题

**验证命令**:
```bash
# F2-C1 Happy path: 执行流程区域内 6 个结构化元素 + 同段落 GWT
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程区域'); process.exit(1); }
  const tpl = c.substring(idx);
  const checks = [
    [/User Stor/, 'User Stories'],
    [/FR-\d{3}/, 'FR-编号'],
    [/SC-\d{3}/, 'SC-编号'],
    [/假设|显式假设/, '假设章节'],
    [/边界/, '边界章节']
  ];
  let fail = false;
  for (const [re, name] of checks) {
    if (!re.test(tpl)) { console.error('MISS: ' + name); fail = true; }
  }
  if (fail) process.exit(1);
  // 同段落 GWT 检查
  const paras = tpl.split(/\n\s*\n/);
  if (!paras.some(p => /Given/.test(p) && /When/.test(p) && /Then/.test(p))) {
    console.error('FAIL: 无同段落 Given-When-Then'); process.exit(1);
  }
  console.log('PASS: 执行流程区域内 6 个结构 + 同段落 GWT 全部存在');
"

# F2-C2 反向验证: 不包含用户交互占位符
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const bad = ['请用户确认', '待用户回答', '请用户输入', '等待用户'];
  const found = bad.filter(f => c.includes(f));
  if (found.length) { console.error('FAIL: ' + found.join(', ')); process.exit(1); }
  console.log('PASS: 无用户交互占位符');
"
```

---

## Feature 3: AI 自决策歧义消解

**行为描述**:
SKILL.md 包含歧义自检步骤，Planner 在撰写 PRD 前执行 9 类歧义扫描（功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号）。无法推断的项标记为 `[ASSUMPTION: ...]`，写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题）。

**硬阈值**:
- 执行流程区域内包含 9 类歧义扫描关键词
- 执行流程区域内包含 `ASSUMPTION` 标记格式说明
- 执行流程区域内包含"方向性"决策提问原则

**验证命令**:
```bash
# F3-C1 Happy path: 执行流程区域内 9 类歧义 + ASSUMPTION + 方向性原则
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = c.substring(idx);
  const cats = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  const miss = cats.filter(x => !tpl.includes(x));
  if (miss.length) { console.error('FAIL: 缺少歧义类别: ' + miss.join(', ')); process.exit(1); }
  if (!tpl.includes('ASSUMPTION')) {
    console.error('FAIL: 缺少 ASSUMPTION 标记'); process.exit(1);
  }
  if (!tpl.includes('方向性')) {
    console.error('FAIL: 缺少方向性决策原则'); process.exit(1);
  }
  console.log('PASS: 9 类歧义 + ASSUMPTION + 方向性决策原则');
"

# F3-C2 边界验证: ASSUMPTION 标记出现在执行流程区域内
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = c.substring(idx);
  if (!tpl.includes('[ASSUMPTION:')) {
    console.error('FAIL: 执行流程区域内缺少 [ASSUMPTION: ...] 示例格式');
    process.exit(1);
  }
  console.log('PASS: ASSUMPTION 标记格式正确');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板包含 `## OKR 对齐` 章节，Planner 从 Brain API 获取当前 OKR 进度，标明任务对应的 KR、当前进度和预期推进量。如果任务与活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- 执行流程区域内 PRD 模板包含 `OKR 对齐` 章节
- 章节包含 KR 编号、进度、推进三字段
- 有"对不上 KR 时写入假设列表"的说明

**验证命令**:
```bash
# F4-C1 Happy path: 执行流程区域内 OKR 对齐章节完整性
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = c.substring(idx);
  if (!tpl.includes('OKR 对齐')) {
    console.error('FAIL: 缺少 OKR 对齐章节'); process.exit(1);
  }
  const fields = ['KR', '进度', '推进'];
  const miss = fields.filter(f => !tpl.includes(f));
  if (miss.length) { console.error('FAIL: OKR 对齐缺少: ' + miss.join(', ')); process.exit(1); }
  console.log('PASS: OKR 对齐章节含 KR/进度/推进');
"

# F4-C2 版本号验证
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const m = c.match(/^version:\s*(.+)$/m);
  if (!m || m[1].trim() !== '5.0.0') {
    console.error('FAIL: version=' + ((m && m[1]) || 'missing'));
    process.exit(1);
  }
  console.log('PASS: frontmatter version=5.0.0');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md v5.0 全量升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件——升级 frontmatter 版本至 v5.0.0、增强 Step 0（Brain API 三端点采集 + 边界声明）、新增歧义自检步骤（9 类扫描 + ASSUMPTION 标记 + 方向性决策原则）、重写 PRD 模板（User Stories/同段落 GWT/FR-SC 编号/假设标题/边界标题/OKR 对齐章节含 KR-进度-推进）
**大小**: M（100-300行，单文件模板大幅扩展）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域内包含 Brain API 三端点（/api/brain/context、/api/brain/tasks、/api/brain/decisions）+ 边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);if(!m){console.error('FAIL:no Step 0');process.exit(1)}const s=m[0];const a=['/api/brain/context','/api/brain/tasks','/api/brain/decisions'];const miss=a.filter(x=>!s.includes(x));if(miss.length){console.error('FAIL:'+miss);process.exit(1)}if(!['不读代码实现','不读实现细节','不探索代码实现'].some(p=>s.includes(p))){console.error('FAIL:no boundary');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 6 个结构化元素（User Stories + 同段落 GWT + FR-编号 + SC-编号 + 假设标题 + 边界标题）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){process.exit(1)}const t=c.substring(idx);if(!/User Stor/.test(t)||!/FR-\d{3}/.test(t)||!/SC-\d{3}/.test(t)||!/假设|显式假设/.test(t)||!/边界/.test(t)){process.exit(1)}const ps=t.split(/\n\s*\n/);if(!ps.some(p=>/Given/.test(p)&&/When/.test(p)&&/Then/.test(p))){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 9 类歧义自检 + ASSUMPTION 标记 + 方向性决策原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){process.exit(1)}const t=c.substring(idx);const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];if(k.some(x=>!t.includes(x))){process.exit(1)}if(!t.includes('ASSUMPTION')||!t.includes('方向性')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 OKR 对齐章节（KR + 进度 + 推进）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){process.exit(1)}const t=c.substring(idx);if(!t.includes('OKR 对齐')||!t.includes('KR')||!t.includes('进度')||!t.includes('推进')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 不包含用户交互占位符（请用户确认/待用户回答/等待用户）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(['请用户确认','待用户回答','等待用户'].some(x=>c.includes(x))){process.exit(1)}console.log('PASS')"
