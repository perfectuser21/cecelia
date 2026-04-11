# Sprint Contract Draft (Round 2)

**PRD 来源**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**目标文件**: `packages/workflows/skills/harness-planner/SKILL.md`（v4.1 → v5.0）
**任务性质**: 单文件模板升级（S-M 规模）
**修订说明**: 根据 Round 1 审查反馈修正 5 项 DoD 弱点（版本号绕过、边界声明遗漏、方向性原则遗漏、推进字段遗漏、匹配范围过宽）

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
当 Planner 执行 Step 0 时，自动调用 Brain API 获取当前系统上下文（OKR 进度、活跃任务、最近 PR、有效决策），将获取到的信息用于后续 PRD 撰写的意图判断和上下文补全。不再仅依赖 `ls`/`cat` 读代码文件，而是先建立业务上下文再探索代码。Step 0 必须明确声明"不读代码实现细节"的边界。

**硬阈值**:
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 调用指令
- Step 0 说明了如何使用 API 返回的上下文信息（OKR/任务/PR/决策）
- Step 0 明确标注"不读代码实现细节"的边界声明

**验证命令**:
```bash
# F1-C1: 验证 Step 0 包含 Brain API 调用
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

# F1-C2: 验证 Step 0 有边界说明（不读代码实现）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('不读代码实现') && !content.includes('不读实现细节') && !content.includes('不探索代码实现')) {
    console.error('FAIL: 缺少「不读代码实现细节」边界声明');
    process.exit(1);
  }
  console.log('PASS: 有明确边界声明');
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
- 以上检查范围限定在 `执行流程` 之后（不含 frontmatter/changelog 区域）

**验证命令**:
```bash
# F2-C1: 验证 PRD 模板包含所有必需章节（范围限定在执行流程之后）
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
    ['假设章节', /假设/],
    ['边界情况章节', /边界/]
  ];
  let fail = false;
  for (const [name, re] of checks) {
    if (!re.test(tpl)) {
      console.error('FAIL: 执行流程区缺少 ' + name);
      fail = true;
    }
  }
  if (fail) process.exit(1);
  console.log('PASS: PRD 模板（执行流程区）包含全部 6 个必需结构');
"

# F2-C2: 验证不包含用户交互占位符
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
SKILL.md 包含歧义自检步骤，Planner 在撰写 PRD 前执行 9 类歧义扫描（功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号）。无法推断的项标记为 `[ASSUMPTION: ...]`，写入假设列表。明确声明"只有影响方向性决策的歧义才向用户提问"的原则。

**硬阈值**:
- SKILL.md 包含 9 类歧义检查的完整列表
- 明确说明无法推断的项标记为 `[ASSUMPTION: ...]`
- 明确包含"方向性"一词，说明只有方向性决策歧义才提问的原则

**验证命令**:
```bash
# F3-C1: 验证 9 类歧义检查 + ASSUMPTION 标记 + 方向性原则
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const categories = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  let missing = categories.filter(x => !content.includes(x));
  if (missing.length > 0) {
    console.error('FAIL: 缺少歧义类别: ' + missing.join(', '));
    process.exit(1);
  }
  if (!content.includes('ASSUMPTION')) {
    console.error('FAIL: 缺少 ASSUMPTION 标记说明');
    process.exit(1);
  }
  if (!content.includes('方向性')) {
    console.error('FAIL: 缺少方向性决策提问原则');
    process.exit(1);
  }
  console.log('PASS: 9 类歧义 + ASSUMPTION + 方向性原则均存在');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板顶部包含 `## OKR 对齐` 章节，标明该任务对应的 KR、当前 KR 进度、本次任务预期推进量。如果任务与活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- PRD 模板包含 `## OKR 对齐` 章节
- 章节模板包含 KR 编号、当前进度、**预期推进**三个字段
- 有"对不上 KR 时写入假设列表"的说明

**验证命令**:
```bash
# F4-C1: 验证 OKR 对齐章节含完整三字段 + 假设 fallback
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('OKR 对齐') && !content.includes('OKR对齐')) {
    console.error('FAIL: PRD 模板缺少 OKR 对齐章节');
    process.exit(1);
  }
  if (!content.includes('KR')) {
    console.error('FAIL: 缺少 KR 字段');
    process.exit(1);
  }
  if (!content.includes('进度')) {
    console.error('FAIL: 缺少进度字段');
    process.exit(1);
  }
  if (!content.includes('推进')) {
    console.error('FAIL: 缺少预期推进字段');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐章节含 KR + 进度 + 推进');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md v5.0 全量升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件——升级 frontmatter 版本、增强 Step 0（Brain API 采集 + 边界声明）、新增歧义自检步骤（含方向性原则）、重写 PRD 模板（User Stories/GWT/FR-SC 编号/假设/边界/OKR 对齐含推进字段）
**大小**: M（100-300行，单文件但模板内容大幅扩展）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 字段值精确为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 包含 `curl localhost:5221/api/brain/context` 且包含"不读代码实现"边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('curl localhost:5221/api/brain/context')){console.error('FAIL: no Brain API');process.exit(1)}if(!c.includes('不读代码实现')&&!c.includes('不读实现细节')&&!c.includes('不探索代码实现')){console.error('FAIL: no boundary statement');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板（执行流程区域内）包含 User Stories + Given-When-Then + FR-编号 + SC-编号 + 假设 + 边界 6 个结构化章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const tpl=c.substring(c.indexOf('执行流程'));if(!tpl){console.error('NO 执行流程');process.exit(1)}const r=[/User Stor/,/Given.*When.*Then/s,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];let f=0;r.forEach((x,i)=>{if(!x.test(tpl)){console.error('MISS:'+i);f=1}});if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 包含 9 类歧义自检列表 + `[ASSUMPTION: ...]` 标记 + "方向性"决策提问原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!c.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!c.includes('ASSUMPTION')){console.error('NO ASSUMPTION');process.exit(1)}if(!c.includes('方向性')){console.error('NO 方向性');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 `## OKR 对齐` 章节，含 KR、进度、推进三个字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR 对齐')){console.error('NO OKR');process.exit(1)}if(!c.includes('KR')||!c.includes('进度')||!c.includes('推进')){console.error('INCOMPLETE: need KR+进度+推进');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符（`请用户确认`/`待用户回答`/`等待用户`）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
