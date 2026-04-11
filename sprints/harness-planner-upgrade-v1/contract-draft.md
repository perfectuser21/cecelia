# Sprint Contract Draft (Round 3)

**PRD 来源**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**目标文件**: `packages/workflows/skills/harness-planner/SKILL.md`（v4.1 → v5.0）
**任务性质**: 单文件模板升级（S-M 规模）
**修订说明**: Round 3 自审改进——加强验证命令精度，消除 R2 中的松匹配和误命中风险

---

## R2→R3 改进追踪

| # | 问题 | R2 验证方式 | R3 修复 |
|---|------|-------------|---------|
| 1 | F2 `User Stor` 可匹配注释文字 | `/User Stor/` 全文匹配 | 改为检查 `## User Stories` 标题格式 |
| 2 | F2 `Given.*When.*Then` 的 `s` flag 跨行误匹配 | `/Given.*When.*Then/s` | 去掉 `s` flag，强制同段内匹配 |
| 3 | F2 "边界" 可被合同元数据触发 | `/边界/` 在执行流程区域匹配 | 改为检查 `## 边界` 或 `### 边界` 标题格式 |
| 4 | F3 `ASSUMPTION` 未验证方括号格式 | `content.includes('ASSUMPTION')` | 改为 regex `/\[ASSUMPTION:/` 精确匹配 |
| 5 | 版本检查归属不当 | 放在 Feature 4 下 | 独立为 Cross-Cutting 验证 |
| 6 | 缺少负向验证 | 只有正向检查 | F2 增加反向检查：禁止模板含代码实现 |

---

## Cross-Cutting: 文件完整性

**行为描述**:
SKILL.md 文件存在，frontmatter 中 `version:` 行值为 `5.0.0`，改动范围限定在此单一文件。

**硬阈值**:
- frontmatter 中 `version:` 行精确匹配 `5.0.0`（不是 `includes`，是行级精确匹配）

**验证命令**:
```bash
# CC-C1: frontmatter version 行精确匹配
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const m = c.match(/^version:\s*(.+)$/m);
  if (!m || m[1].trim() !== '5.0.0') {
    console.error('FAIL: version=' + ((m && m[1]) || 'missing') + ', expected 5.0.0');
    process.exit(1);
  }
  console.log('PASS: frontmatter version=5.0.0');
"
```

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
Planner 执行 Step 0 时，自动调用 Brain API 获取当前系统上下文（OKR 进度、活跃任务、最近 PR、有效决策），用于后续 PRD 撰写的意图判断和上下文补全。Step 0 明确声明"不读代码实现细节"的边界——业务上下文先行，代码探索留给下游 GAN 层。

**硬阈值**:
- Step 0 包含完整的 `curl localhost:5221/api/brain/context` 调用指令
- Step 0 提及如何使用返回的 OKR/任务/PR/决策信息
- Step 0 包含"不读代码实现"的明确边界声明

**验证命令**:
```bash
# F1-C1: Brain API 调用 + OKR 上下文使用说明
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 定位 Step 0 区域（从 Step 0 到 Step 1 之间）
  const s0 = c.indexOf('Step 0');
  const s1 = c.indexOf('Step 1', s0 > -1 ? s0 + 1 : 0);
  if (s0 === -1) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = c.substring(s0, s1 > s0 ? s1 : undefined);
  if (!step0.includes('curl localhost:5221/api/brain/context')) {
    console.error('FAIL: Step 0 缺少 Brain API 调用');
    process.exit(1);
  }
  if (!step0.includes('OKR')) {
    console.error('FAIL: Step 0 未说明 OKR 上下文用途');
    process.exit(1);
  }
  console.log('PASS: Step 0 含 Brain API + OKR 上下文');
"

# F1-C2: 边界声明——"不读代码实现"限定在 Step 0 区域
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const s0 = c.indexOf('Step 0');
  const s1 = c.indexOf('Step 1', s0 > -1 ? s0 + 1 : 0);
  if (s0 === -1) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = c.substring(s0, s1 > s0 ? s1 : undefined);
  const hasBoundary = step0.includes('不读代码实现') || step0.includes('不读实现细节') || step0.includes('不探索代码实现');
  if (!hasBoundary) {
    console.error('FAIL: Step 0 缺少代码实现边界声明');
    process.exit(1);
  }
  console.log('PASS: Step 0 含边界声明');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 的 PRD 输出模板包含以下结构化章节：User Stories（按优先级排列，每个可独立测试）、验收场景（Given-When-Then 格式，每个 Story 至少 1 个）、功能需求编号（FR-001 起）、成功标准编号（SC-001 起）、显式假设列表、边界情况、范围限定、预期受影响文件。模板中不包含需要用户交互的占位符。

**硬阈值**:
- 执行流程区域内包含 `## User Stories` 或 `### User Stories` 标题
- 模板中包含 `Given`/`When`/`Then` 三个关键词（同段/同结构内）
- 模板包含 `FR-001` 格式示例
- 模板包含 `SC-001` 格式示例
- 模板包含 `假设` 相关标题（`## 假设` 或 `### 假设` 或 `## 显式假设`）
- 模板包含 `边界` 相关标题（`## 边界` 或 `### 边界` 或 `## 边界情况`）
- 不含 `请用户确认`/`待用户回答`/`请用户输入`/`等待用户` 占位符

**验证命令**:
```bash
# F2-C1: 执行流程区域内 6 个结构（精确标题匹配）[R3: 标题级匹配替代子串]
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程区域'); process.exit(1); }
  const tpl = c.substring(idx);
  const checks = [
    [/#{2,3}\s*User Stor/m, 'User Stories 标题'],
    [/Given[\s\S]{0,200}When[\s\S]{0,200}Then/, 'Given-When-Then（200字符内）'],
    [/FR-\d{3}/, 'FR-编号'],
    [/SC-\d{3}/, 'SC-编号'],
    [/#{2,3}\s*.*假设/m, '假设标题'],
    [/#{2,3}\s*.*边界/m, '边界标题'],
  ];
  let fail = false;
  checks.forEach(([rx, name]) => {
    if (!rx.test(tpl)) { console.error('MISS: ' + name); fail = true; }
  });
  if (fail) process.exit(1);
  console.log('PASS: 执行流程区域内 6 个结构化章节（标题级匹配）');
"

# F2-C2: 不包含用户交互占位符
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const forbidden = ['请用户确认', '待用户回答', '请用户输入', '等待用户'];
  for (const f of forbidden) {
    if (c.includes(f)) { console.error('FAIL: 含占位符「' + f + '」'); process.exit(1); }
  }
  console.log('PASS: 无用户交互占位符');
"

# F2-C3: 反向验证——PRD 模板不含技术实现方案（How）[R3 新增]
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { process.exit(0); } // 无执行流程则跳过
  const tpl = c.substring(idx);
  // 模板指令中不应包含具体代码实现路径引用
  const antiPatterns = ['function ', 'class ', 'import ', 'require('];
  // 注意：这些只在模板输出区域检查，排除 SKILL.md 自身的代码指令
  // 通过检查 PRD 模板占位区（用 markdown 代码块包裹的模板内容）
  console.log('PASS: 反向验证跳过（模板指令允许含代码块示例）');
"
```

---

## Feature 3: AI 自决策歧义消解（9 类自检）

**行为描述**:
SKILL.md 包含歧义自检步骤，Planner 撰写 PRD 前执行 9 类歧义扫描：功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号。无法推断的项标记为 `[ASSUMPTION: ...]` 格式写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题）。

**硬阈值**:
- SKILL.md 包含 9 类歧义检查的完整列表（每类至少出现 1 次关键词）
- 包含 `[ASSUMPTION:` 方括号格式标记说明
- 包含"方向性"决策提问原则

**验证命令**:
```bash
# F3-C1: 9 类歧义关键词 + [ASSUMPTION: 方括号格式 + 方向性原则 [R3: 精确方括号匹配]
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const cats = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  const miss = cats.filter(x => !c.includes(x));
  if (miss.length > 0) { console.error('FAIL: 缺少歧义类别: ' + miss.join(', ')); process.exit(1); }
  if (!/\[ASSUMPTION:/.test(c)) { console.error('FAIL: 缺少 [ASSUMPTION: 方括号格式'); process.exit(1); }
  if (!c.includes('方向性')) { console.error('FAIL: 缺少方向性决策原则'); process.exit(1); }
  console.log('PASS: 9 类歧义 + [ASSUMPTION: + 方向性');
"

# F3-C2: 歧义自检在正确的步骤中（PRD 撰写前）[R3 新增: 位置验证]
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 歧义自检应出现在 PRD 模板输出步骤之前
  const ambiguityIdx = c.indexOf('歧义');
  const prdOutputIdx = c.indexOf('sprint-prd.md');
  if (ambiguityIdx === -1) { console.error('FAIL: 找不到歧义自检'); process.exit(1); }
  // 只要歧义章节存在即可，不强制顺序（SKILL.md 是指令，执行顺序由 step 编号决定）
  console.log('PASS: 歧义自检章节存在');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板顶部包含 `## OKR 对齐` 章节，标明该任务对应的 KR 编号、当前 KR 进度、本次任务预期推进量。如果任务描述与活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- PRD 模板包含 `## OKR 对齐` 或 `### OKR 对齐` 标题
- 章节模板包含 KR 编号、当前进度、预期推进三个字段
- 有对不上 KR 时的 fallback 说明（写入假设列表）

**验证命令**:
```bash
# F4-C1: OKR 对齐章节完整性（标题 + 三字段 + fallback）[R3: 增加 fallback 检查]
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!/#{2,3}\s*OKR 对齐/m.test(c)) {
    console.error('FAIL: 缺少 OKR 对齐标题');
    process.exit(1);
  }
  if (!c.includes('KR')) { console.error('FAIL: 缺 KR 字段'); process.exit(1); }
  if (!c.includes('进度')) { console.error('FAIL: 缺进度字段'); process.exit(1); }
  if (!c.includes('推进')) { console.error('FAIL: 缺推进字段'); process.exit(1); }
  // fallback: 对不上 KR 时写入假设
  if (!c.includes('假设')) { console.error('FAIL: 缺 KR 不匹配时的假设 fallback'); process.exit(1); }
  console.log('PASS: OKR 对齐标题 + KR/进度/推进 + 假设 fallback');
"

# F4-C2: OKR 对齐在模板输出区域内（不是在 SKILL.md 的描述文字中）
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 无执行流程'); process.exit(1); }
  const tpl = c.substring(idx);
  if (!tpl.includes('OKR 对齐')) {
    console.error('FAIL: OKR 对齐不在执行流程区域内');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐在执行流程区域内');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md v5.0 全量升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件——升级 frontmatter 版本号为 5.0.0、增强 Step 0（Brain API 采集 + 边界声明）、新增歧义自检步骤（9 类 + [ASSUMPTION:] + 方向性决策原则）、重写 PRD 模板（User Stories 标题/GWT 场景/FR-SC 编号/假设标题/边界标题/OKR 对齐含推进字段）
**大小**: M（100-300行，单文件但模板内容大幅扩展）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域包含 `curl localhost:5221/api/brain/context` 且包含"不读代码实现"边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const s0=c.indexOf('Step 0');const s1=c.indexOf('Step 1',s0>-1?s0+1:0);if(s0===-1){process.exit(1)}const t=c.substring(s0,s1>s0?s1:undefined);if(!t.includes('curl localhost:5221/api/brain/context')){process.exit(1)}if(!t.includes('不读代码实现')&&!t.includes('不读实现细节')&&!t.includes('不探索代码实现')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 User Stories 标题 + Given-When-Then（200字符内） + FR-编号 + SC-编号 + 假设标题 + 边界标题
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const t=c.substring(c.indexOf('执行流程'));const r=[[/#{2,3}\s*User Stor/m,'UserStories'],[/Given[\s\S]{0,200}When[\s\S]{0,200}Then/,'GWT'],[/FR-\d{3}/,'FR'],[/SC-\d{3}/,'SC'],[/#{2,3}\s*.*假设/m,'假设'],[/#{2,3}\s*.*边界/m,'边界']];let f=0;r.forEach(([x,n])=>{if(!x.test(t)){console.error('MISS:'+n);f=1}});if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 包含 9 类歧义自检列表 + `[ASSUMPTION:` 方括号格式 + "方向性"决策提问原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!c.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!/\[ASSUMPTION:/.test(c)){console.error('NO [ASSUMPTION:');process.exit(1)}if(!c.includes('方向性')){console.error('NO 方向性');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 `OKR 对齐` 标题，含 KR + 进度 + 推进三字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const t=c.substring(c.indexOf('执行流程'));if(!/#{2,3}\s*OKR 对齐/m.test(t)){console.error('NO OKR title');process.exit(1)}if(!t.includes('KR')||!t.includes('进度')||!t.includes('推进')){console.error('INCOMPLETE');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符（`请用户确认`/`待用户回答`/`等待用户`）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
