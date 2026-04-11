# Sprint Contract Draft (Round 2)

**PRD 来源**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**目标文件**: `packages/workflows/skills/harness-planner/SKILL.md`（v4.1 → v5.0）
**任务性质**: 单文件模板升级（S-M 规模）
**修订说明**: 根据 Round 1 Reviewer 反馈，修复 Feature 4 验证命令——增加"预期推进"字段检查

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
当 Planner 执行 Step 0 时，自动调用 Brain API 获取当前系统上下文（OKR 进度、活跃任务、最近 PR、有效决策），将获取到的信息用于后续 PRD 撰写的意图判断和上下文补全。不再仅依赖 `ls`/`cat` 读代码文件，而是先建立业务上下文再探索代码。

**硬阈值**:
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 调用指令
- Step 0 说明了如何使用 API 返回的上下文信息（OKR/任务/PR/决策）
- Step 0 明确标注"不读代码实现细节"的边界

**验证命令**:
```bash
# 验证 Step 0 包含 Brain API 调用
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('curl localhost:5221/api/brain/context')) {
    console.error('FAIL: Step 0 缺少 curl localhost:5221/api/brain/context');
    process.exit(1);
  }
  if (!content.includes('OKR')) {
    console.error('FAIL: Step 0 未提及 OKR 上下文');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含 Brain API 上下文采集指令');
"

# 验证 Step 0 有边界说明（不读代码实现）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/### Step 0[\s\S]*?### Step 1/);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0 区块'); process.exit(1); }
  const step0 = step0Match[0];
  if (!step0.includes('不读代码实现') && !step0.includes('不读实现细节') && !step0.includes('不探索代码实现')) {
    console.error('FAIL: Step 0 缺少「不读代码实现细节」边界声明');
    process.exit(1);
  }
  console.log('PASS: Step 0 有明确边界声明');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 中的 PRD 模板输出包含以下结构化章节：User Stories（按优先级排列）、验收场景（Given-When-Then 格式）、功能需求编号（FR-001 起）、成功标准编号（SC-001 起）、显式假设列表、边界情况、范围限定、预期受影响文件。每个 User Story 至少关联 1 个 Given-When-Then 验收场景。

**硬阈值**:
- PRD 模板包含 `## User Stories` 章节
- PRD 模板包含 Given-When-Then 格式示例
- PRD 模板包含 `FR-` 编号需求格式
- PRD 模板包含 `SC-` 编号成功标准格式
- PRD 模板包含 `## 显式假设` 或 `## 假设列表` 章节
- PRD 模板包含 `## 边界情况` 章节
- 模板中不包含需要用户交互才能填写的占位符（如 `[请用户确认]`、`[待用户回答]`）

**验证命令**:
```bash
# 验证 PRD 模板包含所有必需章节
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const checks = [
    ['User Stories', /User Stor(y|ies)/],
    ['Given-When-Then', /Given.*When.*Then/s],
    ['FR- 编号', /FR-\d{3}/],
    ['SC- 编号', /SC-\d{3}/],
    ['假设章节', /##.*假设/],
    ['边界情况章节', /##.*边界/]
  ];
  let fail = false;
  for (const [name, re] of checks) {
    if (!re.test(content)) {
      console.error('FAIL: 缺少 ' + name);
      fail = true;
    }
  }
  if (fail) process.exit(1);
  console.log('PASS: PRD 模板包含全部 6 个必需结构');
"

# 验证不包含用户交互占位符
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const forbidden = ['请用户确认', '待用户回答', '请用户输入', '等待用户'];
  for (const f of forbidden) {
    if (content.includes(f)) {
      console.error('FAIL: 包含用户交互占位符「' + f + '」');
      process.exit(1);
    }
  }
  console.log('PASS: 不包含用户交互占位符');
"
```

---

## Feature 3: AI 自决策歧义消解（9 类自检）

**行为描述**:
SKILL.md 包含歧义自检步骤，Planner 在撰写 PRD 前执行 9 类歧义扫描（功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号）。无法推断的项标记为 `[ASSUMPTION: ...]`，写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题）。

**硬阈值**:
- SKILL.md 包含 9 类歧义检查的完整列表
- 明确说明无法推断的项标记为 `[ASSUMPTION: ...]`
- 明确说明"只有影响方向性决策的歧义才提问"的原则

**验证命令**:
```bash
# 验证 9 类歧义检查
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const categories = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  let missing = [];
  for (const cat of categories) {
    if (!content.includes(cat)) missing.push(cat);
  }
  if (missing.length > 0) {
    console.error('FAIL: 缺少歧义类别: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('PASS: 9 类歧义检查全部存在');
"

# 验证 ASSUMPTION 标记说明
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('[ASSUMPTION:') && !content.includes('ASSUMPTION:')) {
    console.error('FAIL: 缺少 ASSUMPTION 标记说明');
    process.exit(1);
  }
  console.log('PASS: 包含 ASSUMPTION 标记说明');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板顶部包含 `## OKR 对齐` 章节，标明该任务对应的 KR、当前 KR 进度、本次任务预期推进量。如果任务与活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- PRD 模板包含 `## OKR 对齐` 章节
- 章节模板包含 KR 编号、当前进度、预期推进三个字段
- 有"对不上 KR 时写入假设列表"的说明

**验证命令**:
```bash
# 验证 OKR 对齐章节（含预期推进字段 — Round 2 修复）
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

# 验证版本号升级
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('5.0.0')) {
    console.error('FAIL: 版本号未升级到 5.0.0');
    process.exit(1);
  }
  console.log('PASS: 版本号为 5.0.0');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md v5.0 全量升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件——升级 frontmatter 版本、增强 Step 0（Brain API 采集）、新增歧义自检步骤、重写 PRD 模板（User Stories/GWT/FR-SC 编号/假设/边界/OKR 对齐）
**大小**: M（100-300行，单文件但模板内容大幅扩展）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter version 为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('5.0.0')){process.exit(1)}console.log('OK')"
- [ ] [BEHAVIOR] Step 0 包含 `curl localhost:5221/api/brain/context` Brain API 上下文采集指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('curl localhost:5221/api/brain/context')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 User Stories + Given-When-Then + FR-编号 + SC-编号 + 假设列表 + 边界情况 6 个结构化章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const r=[/User Stor/,/Given.*When.*Then/s,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];let f=0;r.forEach((x,i)=>{if(!x.test(c)){console.error('MISS:'+i);f=1}});if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 包含 9 类歧义自检列表且无法推断项标记为 `[ASSUMPTION: ...]`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!c.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!c.includes('ASSUMPTION')){console.error('NO ASSUMPTION');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 `## OKR 对齐` 章节，含 KR 编号、进度、预期推进字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR 对齐')){console.error('NO OKR');process.exit(1)}if(!c.includes('KR')||!c.includes('进度')){console.error('INCOMPLETE');process.exit(1)}if(!c.includes('预期推进')&&!c.includes('推进量')&&!c.includes('预期贡献')){console.error('NO ADVANCE');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符（`请用户确认`/`待用户回答`/`等待用户`）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
