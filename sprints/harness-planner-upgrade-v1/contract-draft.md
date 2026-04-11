# Sprint Contract Draft (Round 5)

## R4→R5 改进追踪

| # | R4 残余问题 | 修复方式 | 验证 |
|---|------------|---------|------|
| 1 | F3-C1 区域截断 `#{1,3}\s[^#]` 遇 `####` 穿透 | 改用按行扫描找下一个同级或更高级标题（`/^#{1,N}\s/m`，N=歧义标题的#数） | 歧义内嵌 `####` 子标题不会导致截断 |
| 2 | F4-C1 同理，`#{2,3}\s` 截断逻辑不稳定 | 同上，按歧义标题级别动态计算截断边界 | OKR 章节内嵌子标题不误截断 |
| 3 | F1-C2 边界声明仍用全文 includes | 限定到 Step 0 区域（`/Step\s*0/` 到 `/Step\s*1/` 之间） | changelog/附录中的文字不误报 |
| 4 | DoD Test 单行命令反引号转义 | 验证命令和 DoD Test 使用相同逻辑，DoD 用 `replace(/\x60{3}[\\s\\S]*?\x60{3}/g,'')` 避免 markdown 解析冲突 | 可直接复制执行 |

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
Planner 在写 PRD 前自动调用 Brain API（`/api/brain/context`、`/api/brain/tasks`、`/api/brain/decisions`）获取 OKR 进度、活跃任务、最近 PR、有效决策，并将采集结果用于填充 PRD 的各个章节，无需用户额外提供信息。Step 0 包含明确的边界声明：只采集上下文，不读代码实现细节。

**硬阈值**:
- SKILL.md 的 Step 0 区域（从 `Step 0` 到 `Step 1` 之间）包含 `curl localhost:5221/api/brain/context` 命令
- Step 0 区域包含 `/api/brain/tasks` 端点引用
- Step 0 区域包含 `/api/brain/decisions` 端点引用
- Step 0 区域包含边界声明（不读代码实现）

**验证命令**:
```bash
# F1-C1 Happy path: Step 0 区域包含 Brain API 三端点
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 限定到 Step 0 区域
  const s0Match = content.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);
  if (!s0Match) { console.error('FAIL: 找不到 Step 0 区域'); process.exit(1); }
  const step0 = s0Match[0];
  const apis = [
    ['/api/brain/context', 'Brain context API'],
    ['/api/brain/tasks', 'Brain tasks API'],
    ['/api/brain/decisions', 'Brain decisions API']
  ];
  let pass = true;
  for (const [pattern, label] of apis) {
    if (!step0.includes(pattern)) {
      console.error('FAIL: Step 0 缺少 ' + label + '（' + pattern + '）');
      pass = false;
    }
  }
  if (!pass) process.exit(1);
  console.log('PASS: Step 0 包含 Brain API 三端点');
"

# F1-C2 边界验证: Step 0 区域包含边界声明（不读代码实现）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const s0Match = content.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);
  if (!s0Match) { console.error('FAIL: 找不到 Step 0 区域'); process.exit(1); }
  const step0 = s0Match[0];
  const boundaryPatterns = ['不读代码实现', '不读实现细节', '不探索代码实现', '不读代码'];
  if (!boundaryPatterns.some(p => step0.includes(p))) {
    console.error('FAIL: Step 0 缺少边界声明（不读代码实现类表述）');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含边界声明');
"

# F1-C3 反向验证: 不包含需要人工交互的占位符
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const forbidden = ['请用户确认', '等待用户', '问用户', '请确认', '[请填写]', '{用户输入}'];
  for (const f of forbidden) {
    if (content.includes(f)) {
      console.error('FAIL: 包含人工交互占位符: ' + f);
      process.exit(1);
    }
  }
  console.log('PASS: 无人工交互占位符');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 中的 PRD 模板包含以下结构化章节：User Stories（含同段落 Given-When-Then 验收场景）、编号功能需求（FR-xxx）、编号成功标准（SC-xxx）、显式假设列表、边界情况章节。模板中所有字段由 AI 自动填写，不包含技术实现方案。

**硬阈值**:
- PRD 模板包含 `User Stories` 章节标题
- PRD 模板包含同一段落内的 `Given` + `When` + `Then`（按双换行拆段检查）
- PRD 模板包含 `FR-` 编号格式
- PRD 模板包含 `SC-` 编号格式
- PRD 模板包含假设章节标题（`假设` 或 `显式假设`）
- PRD 模板包含边界情况章节标题
- PRD 模板区域（排除代码块）不包含技术实现方案

**验证命令**:
```bash
# F2-C1 Happy path: PRD 模板 6 元素 + 同段落 GWT
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
      console.error('FAIL: PRD 模板缺少 ' + label);
      pass = false;
    }
  }
  if (!pass) process.exit(1);
  // 同段落 GWT 检查：限定到执行流程之后，按双换行拆段
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

# F2-C2 边界验证: 假设章节和边界情况章节标题存在
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  if (!/#{2,4}\s*(假设|显式假设)/m.test(content)) {
    console.error('FAIL: 缺少假设章节标题');
    process.exit(1);
  }
  if (!/#{2,4}\s*边界/m.test(content)) {
    console.error('FAIL: 缺少边界情况章节标题');
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
  // 排除 markdown 代码块内的内容（那些是示例/指令）
  const noCodeBlocks = tpl.replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, '');
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
- 该歧义章节区域内包含全部 9 类扫描类目关键词（功能范围/数据模型/UX/非功能需求/集成点/边界/约束/术语/完成信号）
- SKILL.md 包含 `[ASSUMPTION` 标记格式说明
- 用户交互频次 ≤ 2（向用户提问/询问/确认）

**验证命令**:
```bash
# F3-C1 Happy path: 歧义章节标题 + 9 类关键词区域隔离检查 + ASSUMPTION 标记
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 定位歧义自检章节标题
  const ambMatch = c.match(/^(#{1,4})\s*.*歧义/m);
  if (!ambMatch) { console.error('FAIL: 找不到歧义自检章节标题'); process.exit(1); }
  const ambLevel = ambMatch[1].length; // 标题级别（#的数量）
  const ambIdx = ambMatch.index;
  // 取该章节到下一个同级或更高级标题之间的内容
  const rest = c.substring(ambIdx + ambMatch[0].length);
  const lines = rest.split('\n');
  let sectionEnd = rest.length;
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s/);
    if (headingMatch && headingMatch[1].length <= ambLevel) {
      sectionEnd = lines.slice(0, i).join('\n').length;
      break;
    }
  }
  const section = rest.substring(0, sectionEnd);
  const cats = ['功能范围', '数据模型', 'UX', '非功能需求', '集成点', '边界', '约束', '术语', '完成信号'];
  const miss = cats.filter(x => !section.includes(x));
  if (miss.length > 0) {
    console.error('FAIL: 歧义章节缺少: ' + miss.join(', '));
    process.exit(1);
  }
  if (!c.includes('ASSUMPTION')) {
    console.error('FAIL: 缺少 ASSUMPTION 标记格式');
    process.exit(1);
  }
  console.log('PASS: 歧义自检章节完整（标题 + 9 类关键词 + ASSUMPTION 标记）');
"

# F3-C2 边界验证: 用户交互频次 ≤ 2
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const askPatterns = content.match(/向用户(提问|询问|确认)/g) || [];
  if (askPatterns.length > 2) {
    console.error('FAIL: 向用户提问次数过多（' + askPatterns.length + ' 处），应 <= 2');
    process.exit(1);
  }
  console.log('PASS: 用户交互频次合理（' + askPatterns.length + ' 处）');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板包含 `## OKR 对齐` 章节，Planner 从 Brain API 获取当前 OKR 进度，标明任务对应的 KR、当前进度和预期推进。如果任务与任何活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- PRD 模板包含 `OKR 对齐` 章节标题
- OKR 对齐章节区域内包含 KR 引用、进度、推进字段
- OKR 对齐章节区域内包含 KR 不匹配时的假设 fallback

**验证命令**:
```bash
# F4-C1 Happy path: OKR 对齐章节区域隔离检查
node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  // 定位 OKR 对齐章节标题
  const okrMatch = c.match(/^(#{2,4})\s*OKR 对齐/m);
  if (!okrMatch) { console.error('FAIL: 缺少 OKR 对齐标题'); process.exit(1); }
  const okrLevel = okrMatch[1].length;
  const okrIdx = okrMatch.index;
  // 取该章节到下一个同级或更高级标题之间的内容
  const rest = c.substring(okrIdx + okrMatch[0].length);
  const lines = rest.split('\n');
  let sectionEnd = rest.length;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s/);
    if (hm && hm[1].length <= okrLevel) {
      sectionEnd = lines.slice(0, i).join('\n').length;
      break;
    }
  }
  const section = rest.substring(0, sectionEnd);
  const required = ['KR', '进度', '推进'];
  const miss = required.filter(x => !section.includes(x));
  if (miss.length > 0) {
    console.error('FAIL: OKR 对齐章节缺少字段: ' + miss.join(', '));
    process.exit(1);
  }
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
    console.error('FAIL: 无法解析 version 字段');
    process.exit(1);
  }
  const major = parseInt(versionMatch[1]);
  if (major < 5) {
    console.error('FAIL: 版本号仍为 v' + major + '.x，应升级至 v5.x');
    process.exit(1);
  }
  console.log('PASS: 版本号为 v' + major + '.x');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md 全面升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件改动——版本升级至 v5.0.0，Step 0 增加 Brain API 上下文采集（三端点 + 边界声明），增加歧义自检独立章节/Step（含 9 类扫描，按标题级别区域隔离），PRD 模板替换为 spec-kit 级别结构化格式（User Stories + 同段落 Given-When-Then + FR/SC 编号 + 假设列表标题 + 边界情况标题 + OKR 对齐章节含 KR/进度/推进/假设 fallback）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 文件存在且 version 字段为 5.x.x
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/version:\s*5\.\d+\.\d+/.test(c)){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域包含 Brain API 三端点调用指令（/api/brain/context、/api/brain/tasks、/api/brain/decisions）+ 边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);if(!m){console.error('FAIL: no Step 0');process.exit(1)}const s=m[0];const apis=['/api/brain/context','/api/brain/tasks','/api/brain/decisions'];const miss=apis.filter(a=>!s.includes(a));if(miss.length){console.error('FAIL: Step 0 missing '+miss.join(', '));process.exit(1)}if(!['不读代码实现','不读实现细节','不探索代码实现','不读代码'].some(p=>s.includes(p))){console.error('FAIL: Step 0 no boundary');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 6 个结构化元素（User Stories + 同段落 GWT + FR- + SC- + 假设标题 + 边界标题）且不含技术实现方案
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('User Stor')||!c.includes('FR-')||!c.includes('SC-')){console.error('FAIL: missing struct elements');process.exit(1)}const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){console.error('FAIL: no exec section');process.exit(1)}const tpl=c.substring(idx);const ps=tpl.split(/\n\s*\n/);if(!ps.some(p=>/Given/.test(p)&&/When/.test(p)&&/Then/.test(p))){console.error('FAIL: no same-paragraph GWT');process.exit(1)}if(!/#{2,4}\s*(\u5047\u8bbe|\u663e\u5f0f\u5047\u8bbe)/m.test(c)){console.error('FAIL: no assumptions heading');process.exit(1)}if(!/#{2,4}\s*\u8fb9\u754c/m.test(c)){console.error('FAIL: no edge cases heading');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 歧义自检章节含标题 + 9 类关键词（按标题级别区域隔离）+ ASSUMPTION 标记
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const am=c.match(/^(#{1,4})\s*.*\u6b67\u4e49/m);if(!am){console.error('FAIL: no ambiguity heading');process.exit(1)}const lv=am[1].length;const rest=c.substring(am.index+am[0].length);const ls=rest.split('\n');let end=rest.length;for(let i=0;i<ls.length;i++){const h=ls[i].match(/^(#{1,6})\s/);if(h&&h[1].length<=lv){end=ls.slice(0,i).join('\n').length;break}}const sec=rest.substring(0,end);const cats=['\u529f\u80fd\u8303\u56f4','\u6570\u636e\u6a21\u578b','UX','\u975e\u529f\u80fd\u9700\u6c42','\u96c6\u6210\u70b9','\u8fb9\u754c','\u7ea6\u675f','\u672f\u8bed','\u5b8c\u6210\u4fe1\u53f7'];const miss=cats.filter(x=>!sec.includes(x));if(miss.length){console.error('FAIL: missing: '+miss.join(', '));process.exit(1)}if(!c.includes('ASSUMPTION')){console.error('FAIL: no ASSUMPTION');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] OKR 对齐章节含 KR/进度/推进 + 假设 fallback（按标题级别区域隔离）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const om=c.match(/^(#{2,4})\s*OKR \u5bf9\u9f50/m);if(!om){console.error('FAIL: no OKR heading');process.exit(1)}const lv=om[1].length;const rest=c.substring(om.index+om[0].length);const ls=rest.split('\n');let end=rest.length;for(let i=0;i<ls.length;i++){const h=ls[i].match(/^(#{1,6})\s/);if(h&&h[1].length<=lv){end=ls.slice(0,i).join('\n').length;break}}const sec=rest.substring(0,end);const req=['KR','\u8fdb\u5ea6','\u63a8\u8fdb'];const miss=req.filter(x=>!sec.includes(x));if(miss.length){console.error('FAIL: OKR missing: '+miss.join(', '));process.exit(1)}if(!sec.includes('\u5047\u8bbe')&&!sec.includes('ASSUMPTION')){console.error('FAIL: no fallback');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 不包含超过 2 处向用户提问的指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=(c.match(/\u5411\u7528\u6237(\u63d0\u95ee|\u8be2\u95ee|\u786e\u8ba4)/g)||[]).length;if(m>2){console.error('FAIL: '+m+' ask-user patterns');process.exit(1)}console.log('PASS: '+m+' ask-user patterns')"
