# Sprint Contract Draft (Round 4)

## R3→R4 改进追踪

| # | R3 issue | 修复方式 | 验证 |
|---|----------|---------|------|
| 1 | F2-C3 反向验证无条件 PASS（空操作） | 替换为真实检查：排除代码块后扫描技术实现关键词 | 假实现含 `技术实现方案` 会被检出 |
| 2 | F2-C1 GWT `[\s\S]{0,200}` 跨行匹配 | 改为同段落检查（按双换行拆段，每段独立检测 Given+When+Then） | 三词分散在不同章节不再误报 PASS |
| 3 | F3-C1 歧义 9 类全文搜索 | 限定到歧义章节标题至下一个同级标题之间的区域 | 散落各处的关键词不再误报 |
| 4 | F3-C2 仅 indexOf('歧义') 无结构验证 | 合并到 F3-C1 区域化检查，删除独立命令 | — |
| 5 | F4-C1 OKR 对齐全文 includes | 限定到 OKR 对齐章节区域内检查 KR/进度/推进 + 假设 fallback | 散落别处不再误报 |

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
Planner 在写 PRD 前自动调用 Brain API（`/api/brain/context`）获取 OKR 进度、活跃任务、最近 PR、有效决策，并将采集结果用于填充 PRD 的各个章节，无需用户额外提供信息。

**硬阈值**:
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 命令
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/tasks` 命令
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/decisions` 命令

**验证命令**:
```bash
# F1-C1 Happy path: SKILL.md 包含 Brain API 调用指令
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

# F1-C2 边界验证: 不包含需要人工交互的占位符
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
- PRD 模板在同一段落内包含 `Given` + `When` + `Then`（不允许跨章节散落）
- PRD 模板包含 `FR-` 编号格式
- PRD 模板包含 `SC-` 编号格式
- PRD 模板包含 `## 假设` 或 `## 显式假设` 章节
- PRD 模板包含 `## 边界情况` 章节
- PRD 模板区域（排除代码块示例）不包含技术实现方案

**验证命令**:
```bash
# F2-C1 Happy path: PRD 模板包含 6 个结构化章节 + 同段落 GWT 检查
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 基础存在性检查
  const required = [
    ['User Stor', 'User Stories 章节'],
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
  if (!pass) process.exit(1);
  // 同段落 GWT 检查：按双换行拆段，同一段落内必须同时出现 Given + When + Then
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程区域'); process.exit(1); }
  const tpl = content.substring(idx);
  const paragraphs = tpl.split(/\n\s*\n/);
  const hasGWT = paragraphs.some(p => /Given/.test(p) && /When/.test(p) && /Then/.test(p));
  if (!hasGWT) {
    console.error('FAIL: 无同段落 Given-When-Then 场景');
    process.exit(1);
  }
  console.log('PASS: PRD 模板包含全部结构化章节 + 同段落 GWT');
"

# F2-C2 边界验证: 假设章节和边界情况章节存在（标题级检查）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!/#{2,4}\s*(假设|显式假设)/m.test(content)) {
    console.log('FAIL: 缺少假设章节标题');
    process.exit(1);
  }
  if (!/#{2,4}\s*边界/m.test(content)) {
    console.log('FAIL: 缺少边界情况章节标题');
    process.exit(1);
  }
  console.log('PASS: 假设章节和边界情况章节标题均存在');
"

# F2-C3 反向验证: PRD 模板不含技术实现方案（排除代码块后检查）
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = c.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 无执行流程'); process.exit(1); }
  const tpl = c.substring(idx);
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

## Feature 3: AI 自决策歧义消解

**行为描述**:
SKILL.md 包含独立的歧义自检章节（或 Step），其中列出 9 类歧义扫描指令。每类歧义由 AI 通过 Brain API / 代码库 / OKR 上下文自动解答。无法推断的项标记为 `[ASSUMPTION: ...]` 写入假设列表，而非停下来向用户提问。只有影响方向性决策的重大歧义才允许向用户提问（预期 0-1 个）。

**硬阈值**:
- SKILL.md 包含以「歧义」为标题关键词的独立章节或 Step
- 该歧义章节内包含全部 9 类扫描类目关键词
- SKILL.md 包含 `[ASSUMPTION` 标记格式说明

**验证命令**:
```bash
# F3-C1 Happy path: 歧义章节存在 + 9 类关键词均在歧义章节区域内
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 定位歧义自检区域（独立 Step 或章节）
  const ambIdx = c.search(/#{1,4}\s*.*歧义/m);
  if (ambIdx === -1) { console.error('FAIL: 找不到歧义自检章节标题'); process.exit(1); }
  // 取该章节到下一个同级标题之间的内容
  const rest = c.substring(ambIdx);
  const nextSection = rest.search(/\n#{1,3}\s[^#]/m);
  const section = nextSection > 10 ? rest.substring(0, nextSection) : rest;
  const cats = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  const miss = cats.filter(x => !section.includes(x));
  if (miss.length > 0) { console.error('FAIL: 歧义章节缺少: ' + miss.join(', ')); process.exit(1); }
  // ASSUMPTION 标记检查
  if (!c.includes('ASSUMPTION')) {
    console.error('FAIL: 缺少 ASSUMPTION 标记格式');
    process.exit(1);
  }
  console.log('PASS: 歧义自检章节完整（标题 + 9 类关键词 + ASSUMPTION 标记）');
"

# F3-C2 边界验证: 不包含多次停下来问用户的指令
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
PRD 模板顶部包含 `## OKR 对齐` 章节，Planner 从 Brain API 获取当前 OKR 进度，标明任务对应的 KR、当前进度和预期推进。如果任务与任何活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- PRD 模板包含 `## OKR 对齐` 或 `### OKR 对齐` 章节标题
- OKR 对齐章节内包含 KR 引用、进度、推进字段
- OKR 对齐章节内包含 KR 不匹配时的假设 fallback

**验证命令**:
```bash
# F4-C1 Happy path: OKR 对齐章节区域化检查
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

# F4-C2 边界验证: 版本号已更新为 5.x
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

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件改动——版本升级至 v5.0.0，Step 0 增加 Brain API 上下文采集，增加歧义自检独立章节/Step（含 9 类扫描），PRD 模板替换为 spec-kit 级别结构化格式（User Stories + 同段落 Given-When-Then + FR/SC 编号 + 假设列表标题 + 边界情况标题 + OKR 对齐章节含 KR/进度/推进/假设 fallback）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 文件存在且 version 字段为 5.x.x
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/version:\s*5\.\d+\.\d+/.test(c)){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 包含 Brain API 三端点调用指令（/api/brain/context、/api/brain/tasks、/api/brain/decisions）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const apis=['/api/brain/context','/api/brain/tasks','/api/brain/decisions'];const missing=apis.filter(a=>!c.includes(a));if(missing.length){console.log('FAIL: missing '+missing.join(', '));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 6 个结构化元素（User Stories + 同段落 GWT + FR- + SC- + 假设标题 + 边界标题）且不含技术实现方案
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const r=['User Stor','FR-','SC-'];const m=r.filter(k=>!c.includes(k));if(m.length){console.log('FAIL: missing '+m.join(', '));process.exit(1)}const idx=c.indexOf('执行流程');if(idx===-1){console.log('FAIL: no 执行流程');process.exit(1)}const tpl=c.substring(idx);const ps=tpl.split(/\n\s*\n/);if(!ps.some(p=>/Given/.test(p)&&/When/.test(p)&&/Then/.test(p))){console.log('FAIL: no same-paragraph GWT');process.exit(1)}if(!/#{2,4}\s*(假设|显式假设)/m.test(c)){console.log('FAIL: no assumptions heading');process.exit(1)}if(!/#{2,4}\s*边界/m.test(c)){console.log('FAIL: no edge cases heading');process.exit(1)}const nb=tpl.replace(/\x60\x60\x60[\\s\\S]*?\x60\x60\x60/g,'');if(['技术实现方案','代码实现'].some(p=>nb.includes(p))){console.log('FAIL: contains impl');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 歧义自检章节含标题 + 9 类关键词（区域隔离检查）+ ASSUMPTION 标记
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const ai=c.search(/#{1,4}\s*.*歧义/m);if(ai===-1){console.log('FAIL: no ambiguity heading');process.exit(1)}const rest=c.substring(ai);const ns=rest.search(/\n#{1,3}\s[^#]/m);const sec=ns>10?rest.substring(0,ns):rest;const cats=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];const miss=cats.filter(x=>!sec.includes(x));if(miss.length){console.log('FAIL: ambiguity section missing: '+miss.join(', '));process.exit(1)}if(!c.includes('ASSUMPTION')){console.log('FAIL: no ASSUMPTION marker');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] OKR 对齐章节含 KR/进度/推进 + 假设 fallback（区域隔离检查）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/#{2,3}\s*OKR 对齐/m);if(!m){console.log('FAIL: no OKR heading');process.exit(1)}const rest=c.substring(m.index);const nh=rest.search(/\n#{2,3}\s/);const sec=nh>10?rest.substring(0,nh):rest;const req=['KR','进度','推进'];const miss=req.filter(x=>!sec.includes(x));if(miss.length){console.log('FAIL: OKR section missing: '+miss.join(', '));process.exit(1)}if(!sec.includes('假设')&&!sec.includes('ASSUMPTION')){console.log('FAIL: no assumption fallback in OKR');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 不包含超过 2 处向用户提问的指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=(c.match(/向用户(提问|询问|确认)/g)||[]).length;if(m>2){console.log('FAIL: '+m+' ask-user patterns');process.exit(1)}console.log('PASS: '+m+' ask-user patterns')"
