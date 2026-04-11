# Sprint Contract Draft (Round 1)

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
Planner 在写 PRD 前自动调用 Brain API（`/api/brain/context`）获取 OKR 进度、活跃任务、最近 PR、有效决策，并将采集结果用于填充 PRD 的各个章节，无需用户额外提供信息。

**硬阈值**:
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 命令
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/tasks` 命令
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/decisions` 命令

**验证命令**:
```bash
# Happy path: SKILL.md 包含 Brain API 调用指令
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const checks = [
    ['/api/brain/context', 'Brain context API'],
    ['/api/brain/tasks', 'Brain tasks API'],
    ['/api/brain/decisions', 'Brain decisions API']
  ];
  let pass = true;
  for (const [pattern, label] of checks) {
    if (!content.includes(pattern)) {
      console.log('FAIL: 缺少 ' + label + ' 调用（' + pattern + '）');
      pass = false;
    }
  }
  if (pass) console.log('PASS: Brain API 三端点全部包含');
  else process.exit(1);
"

# 边界验证: 不包含需要人工交互的占位符
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const forbidden = ['请用户确认', '等待用户', '问用户', '请确认'];
  for (const f of forbidden) {
    if (content.includes(f)) {
      console.log('FAIL: 包含人工交互占位符: ' + f);
      process.exit(1);
    }
  }
  console.log('PASS: 无人工交互占位符');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 中的 PRD 模板包含以下结构化章节：User Stories（含 Given-When-Then 验收场景）、编号功能需求（FR-xxx）、编号成功标准（SC-xxx）、显式假设列表、边界情况章节。模板中所有字段由 AI 自动填写，无需人工输入。

**硬阈值**:
- PRD 模板包含 `## User Stories` 章节
- PRD 模板包含 `Given` / `When` / `Then` 关键词
- PRD 模板包含 `FR-` 编号格式
- PRD 模板包含 `SC-` 编号格式
- PRD 模板包含 `## 假设` 或 `## 显式假设` 章节
- PRD 模板包含 `## 边界情况` 章节

**验证命令**:
```bash
# Happy path: PRD 模板包含所有结构化章节
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const required = [
    ['User Stor', 'User Stories 章节'],
    ['Given', 'Given-When-Then 验收场景（Given）'],
    ['When', 'Given-When-Then 验收场景（When）'],
    ['Then', 'Given-When-Then 验收场景（Then）'],
    ['FR-', '功能需求编号（FR-xxx）'],
    ['SC-', '成功标准编号（SC-xxx）']
  ];
  let pass = true;
  for (const [pattern, label] of required) {
    if (!content.includes(pattern)) {
      console.log('FAIL: PRD 模板缺少 ' + label);
      pass = false;
    }
  }
  if (pass) console.log('PASS: PRD 模板包含全部结构化章节');
  else process.exit(1);
"

# 边界验证: 假设章节和边界情况章节存在
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const hasAssumptions = content.includes('假设') && (content.includes('## 假设') || content.includes('## 显式假设') || content.includes('ASSUMPTION'));
  const hasEdgeCases = content.includes('边界') && (content.includes('## 边界') || content.includes('Edge Case'));
  if (!hasAssumptions) { console.log('FAIL: 缺少假设章节'); process.exit(1); }
  if (!hasEdgeCases) { console.log('FAIL: 缺少边界情况章节'); process.exit(1); }
  console.log('PASS: 假设章节和边界情况章节均存在');
"
```

---

## Feature 3: AI 自决策歧义消解

**行为描述**:
SKILL.md 包含 9 类歧义自检扫描指令，每类歧义由 AI 通过 Brain API / 代码库 / OKR 上下文自动解答。无法推断的项标记为 `[ASSUMPTION: ...]` 写入假设列表，而非停下来向用户提问。只有影响方向性决策的重大歧义才允许向用户提问（预期 0-1 个）。

**硬阈值**:
- SKILL.md 包含"歧义"或"自检"或"消解"相关指令
- SKILL.md 包含 `[ASSUMPTION` 标记格式说明
- SKILL.md 包含至少 5 类歧义扫描类目（功能范围/数据模型/非功能需求/边界情况/完成信号等）

**验证命令**:
```bash
# Happy path: 歧义消解机制存在
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('ASSUMPTION')) {
    console.log('FAIL: 缺少 ASSUMPTION 标记格式');
    process.exit(1);
  }
  const categories = ['功能范围', '数据模型', '非功能', '边界', '完成信号', '集成', '约束', 'UX', '术语'];
  let found = 0;
  for (const cat of categories) {
    if (content.includes(cat)) found++;
  }
  if (found < 5) {
    console.log('FAIL: 歧义扫描类目不足 5 类（找到 ' + found + ' 类）');
    process.exit(1);
  }
  console.log('PASS: 歧义消解机制完整（' + found + ' 类扫描）');
"

# 边界验证: 不包含多次停下来问用户的指令
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const askPatterns = content.match(/向用户(提问|询问|确认)/g) || [];
  if (askPatterns.length > 2) {
    console.log('FAIL: 向用户提问次数过多（' + askPatterns.length + ' 处），应 <= 2');
    process.exit(1);
  }
  console.log('PASS: 用户交互频次合理（' + askPatterns.length + ' 处）');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板顶部包含 `## OKR 对齐` 章节，Planner 从 Brain API 获取当前 OKR 进度，标明任务对应的 KR、当前进度和预期推进。

**硬阈值**:
- PRD 模板包含 `## OKR 对齐` 或 `OKR` 相关章节
- SKILL.md 中有从 Brain context 提取 OKR 信息的指令

**验证命令**:
```bash
# Happy path: PRD 模板包含 OKR 对齐章节
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!content.includes('OKR')) {
    console.log('FAIL: PRD 模板缺少 OKR 相关章节');
    process.exit(1);
  }
  if (!content.includes('对齐') && !content.includes('alignment')) {
    console.log('FAIL: 缺少 OKR 对齐检查指令');
    process.exit(1);
  }
  console.log('PASS: OKR 对齐章节存在');
"

# 边界验证: 版本号已更新为 5.x
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const versionMatch = content.match(/version:\s*(\d+)\.\d+\.\d+/);
  if (!versionMatch) {
    console.log('FAIL: 无法解析 version 字段');
    process.exit(1);
  }
  const major = parseInt(versionMatch[1]);
  if (major < 5) {
    console.log('FAIL: 版本号仍为 v' + major + '.x，应升级至 v5.x');
    process.exit(1);
  }
  console.log('PASS: 版本号为 v' + major + '.x');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md 全面升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件改动——版本升级至 v5.0.0，Step 0 增加 Brain API 上下文采集，Step 1 增加 9 类歧义自检，Step 2 PRD 模板替换为 spec-kit 级别结构化格式（User Stories + Given-When-Then + FR/SC 编号 + 假设列表 + 边界情况 + OKR 对齐）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 文件存在且 version 字段为 5.x.x
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/version:\s*5\.\d+\.\d+/.test(c)){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 包含 Brain API 三端点调用指令（/api/brain/context、/api/brain/tasks、/api/brain/decisions）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const apis=['/api/brain/context','/api/brain/tasks','/api/brain/decisions'];const missing=apis.filter(a=>!c.includes(a));if(missing.length){console.log('FAIL: missing '+missing.join(', '));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 User Stories 章节、Given-When-Then 验收场景、FR-xxx 功能需求编号、SC-xxx 成功标准编号
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const checks=['User Stor','Given','When','Then','FR-','SC-'];const missing=checks.filter(k=>!c.includes(k));if(missing.length){console.log('FAIL: missing '+missing.join(', '));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含假设列表章节和边界情况章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('假设')){console.log('FAIL: no assumptions');process.exit(1)}if(!c.includes('边界')){console.log('FAIL: no edge cases');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 包含 ASSUMPTION 标记格式和至少 5 类歧义扫描类目
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('ASSUMPTION')){console.log('FAIL: no ASSUMPTION marker');process.exit(1)}const cats=['功能范围','数据模型','非功能','边界','完成信号'];const found=cats.filter(x=>c.includes(x)).length;if(found<5){console.log('FAIL: only '+found+'/5 categories');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 OKR 对齐章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR')|| !c.includes('对齐')){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 不包含超过 2 处向用户提问的指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=(c.match(/向用户(提问|询问|确认)/g)||[]).length;if(m>2){console.log('FAIL: '+m+' ask-user patterns');process.exit(1)}console.log('PASS: '+m+' ask-user patterns')"
