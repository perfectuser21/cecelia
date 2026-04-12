# Sprint Contract Draft (Round 3)

**PRD 来源**: `sprints/harness-planner-upgrade-v1/sprint-prd.md`
**目标文件**: `packages/workflows/skills/harness-planner/SKILL.md`（v4.1 → v5.0）
**任务性质**: 单文件模板升级（S-M 规模）
**修订说明**: 根据 Round 2 Reviewer 反馈修复 3 项——统一所有验证命令限定到执行流程区域

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

### Round 2 → Round 3（本轮修复）

| # | 反馈类型 | 原始问题 | 修复方式 |
|---|----------|----------|----------|
| 6 | 命令太弱 | F1-C2 边界声明检查用全文 `includes()`，可被 changelog 绕过 | 限定匹配范围到 Step 0 区域（regex 提取 Step 0 段落） |
| 7 | 命令太弱 | F3-C1 9 类歧义检查用全文 `includes()`，可被附录/术语表绕过 | 限定匹配范围到 `执行流程` 之后 |
| 8 | 命令太弱 | F4-C1 OKR 对齐检查用全文 `includes()`，可被 changelog 绕过 | 限定匹配范围到 `执行流程` 之后 |

---

## Feature 1: 自动上下文采集（Step 0 增强）

**行为描述**:
当 Planner 执行 Step 0 时，自动调用 Brain API 获取当前系统上下文（OKR 进度、活跃任务、最近 PR、有效决策），将获取到的信息用于后续 PRD 撰写的意图判断和上下文补全。不再仅依赖 `ls`/`cat` 读代码文件，而是先建立业务上下文再探索代码。Step 0 明确声明"不读代码实现细节"的边界。

**硬阈值**:
- SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 调用指令
- Step 0 说明了如何使用 API 返回的上下文信息（OKR/任务/PR/决策）
- Step 0 明确标注"不读代码实现细节"的边界

**验证命令**:
```bash
# F1-C1: 验证 Step 0 包含 Brain API 调用（限定到 Step 0 区域）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/Step\s*0[^]*?(?=###\s*Step\s*1|###\s)/i);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = step0Match[0];
  if (!step0.includes('curl localhost:5221/api/brain/context')) {
    console.error('FAIL: Step 0 缺少 Brain API 调用');
    process.exit(1);
  }
  if (!step0.includes('OKR')) {
    console.error('FAIL: Step 0 未提及 OKR 上下文');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含 Brain API 上下文采集指令');
"

# F1-C2: 验证 Step 0 有边界声明（不读代码实现）[REVISION#6: 限定到 Step 0 区域]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const step0Match = content.match(/Step\s*0[^]*?(?=###\s*Step\s*1|###\s)/i);
  if (!step0Match) { console.error('FAIL: 找不到 Step 0'); process.exit(1); }
  const step0 = step0Match[0];
  if (!step0.includes('curl localhost:5221/api/brain/context')) {
    console.error('FAIL: Step 0 缺少 Brain API');
    process.exit(1);
  }
  if (!step0.includes('不读代码实现') && !step0.includes('不读实现细节') && !step0.includes('不探索代码实现')) {
    console.error('FAIL: Step 0 缺少边界声明');
    process.exit(1);
  }
  console.log('PASS: Step 0 包含 Brain API + 边界声明');
"
```

---

## Feature 2: 结构化 PRD 模板（spec-kit 级别）

**行为描述**:
SKILL.md 中的 PRD 模板输出包含以下结构化章节：User Stories（按优先级排列）、验收场景（Given-When-Then 格式）、功能需求编号（FR-001 起）、成功标准编号（SC-001 起）、显式假设列表、边界情况、范围限定、预期受影响文件。每个 User Story 至少关联 1 个 Given-When-Then 验收场景。

**硬阈值**:
- PRD 模板（执行流程区域内）包含 `User Stories` 章节
- PRD 模板包含 Given-When-Then 格式示例
- PRD 模板包含 `FR-` 编号需求格式
- PRD 模板包含 `SC-` 编号成功标准格式
- PRD 模板包含 `假设` 章节
- PRD 模板包含 `边界` 章节
- 模板中不包含需要用户交互才能填写的占位符

**验证命令**:
```bash
# F2-C1: 验证执行流程区域内 6 个结构（Round 2 已修复，保持不变）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程区域'); process.exit(1); }
  const tpl = content.substring(idx);
  const r = [/User Stor/, /Given.*When.*Then/s, /FR-\d{3}/, /SC-\d{3}/, /假设/, /边界/];
  const names = ['User Stories', 'Given-When-Then', 'FR-编号', 'SC-编号', '假设', '边界'];
  let fail = false;
  r.forEach((x, i) => {
    if (!x.test(tpl)) { console.error('MISS: ' + names[i]); fail = true; }
  });
  if (fail) process.exit(1);
  console.log('PASS: 执行流程区域内 6 个结构全部存在');
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
SKILL.md 包含歧义自检步骤，Planner 在撰写 PRD 前执行 9 类歧义扫描（功能范围、数据模型、UX 流程、非功能需求、集成点、边界情况、约束、术语、完成信号）。无法推断的项标记为 `[ASSUMPTION: ...]`，写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题）。

**硬阈值**:
- 执行流程区域内包含 9 类歧义检查的完整列表
- 执行流程区域内明确说明无法推断的项标记为 `[ASSUMPTION: ...]`
- 执行流程区域内明确说明"只有影响方向性决策的歧义才提问"的原则

**验证命令**:
```bash
# F3-C1: 验证执行流程区域内 9 类歧义 + ASSUMPTION + 方向性决策原则 [REVISION#7: 限定到执行流程之后]
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

# F3-C2: 验证 ASSUMPTION 标记格式（限定到执行流程之后）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  if (!tpl.includes('[ASSUMPTION:') && !tpl.includes('ASSUMPTION:')) {
    console.error('FAIL: 执行流程区域内缺少 [ASSUMPTION: ...] 示例格式');
    process.exit(1);
  }
  console.log('PASS: 执行流程区域内 ASSUMPTION 标记格式正确');
"
```

---

## Feature 4: OKR 对齐检查

**行为描述**:
PRD 模板顶部包含 `## OKR 对齐` 章节，标明该任务对应的 KR、当前 KR 进度、本次任务预期推进量。如果任务与活跃 KR 对不上，在假设列表中标注。

**硬阈值**:
- 执行流程区域内 PRD 模板包含 `OKR 对齐` 章节
- 章节模板包含 KR 编号、当前进度、预期推进三个字段
- 有"对不上 KR 时写入假设列表"的说明

**验证命令**:
```bash
# F4-C1: 验证执行流程区域内 OKR 对齐章节完整性 [REVISION#8: 限定到执行流程之后]
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/workflows/skills/harness-planner/SKILL.md', 'utf8');
  const idx = content.indexOf('执行流程');
  if (idx === -1) { console.error('FAIL: 找不到执行流程'); process.exit(1); }
  const tpl = content.substring(idx);
  if (!tpl.includes('OKR 对齐')) {
    console.error('FAIL: 执行流程区域内缺少 OKR 对齐章节');
    process.exit(1);
  }
  if (!tpl.includes('KR') || !tpl.includes('进度') || !tpl.includes('推进')) {
    console.error('FAIL: OKR 对齐章节不完整（需要 KR + 进度 + 推进）');
    process.exit(1);
  }
  console.log('PASS: 执行流程区域内 OKR 对齐章节包含 KR/进度/推进');
"

# F4-C2: 验证版本号（Round 2 已修复，保持不变）
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

## Workstreams

workstream_count: 1

### Workstream 1: SKILL.md v5.0 全量升级

**范围**: `packages/workflows/skills/harness-planner/SKILL.md` 单文件——升级 frontmatter 版本、增强 Step 0（Brain API 采集 + 边界声明）、新增歧义自检步骤（含方向性决策原则）、重写 PRD 模板（User Stories/GWT/FR-SC 编号/假设/边界/OKR 对齐含推进字段）
**大小**: M（100-300行，单文件但模板内容大幅扩展）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域内包含 `curl localhost:5221/api/brain/context` 且包含"不读代码实现"边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/Step\s*0[^]*?(?=###\s*Step\s*1|###\s)/i);if(!m){console.error('FAIL: no Step 0');process.exit(1)}const s=m[0];if(!s.includes('curl localhost:5221/api/brain/context')){console.error('FAIL: Step 0 no Brain API');process.exit(1)}if(!s.includes('不读代码实现')&&!s.includes('不读实现细节')&&!s.includes('不探索代码实现')){console.error('FAIL: Step 0 no boundary');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 User Stories + Given-When-Then + FR-编号 + SC-编号 + 假设 + 边界 6 个结构化章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){console.error('NO 执行流程');process.exit(1)}const tpl=c.substring(idx);const r=[/User Stor/,/Given.*When.*Then/s,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];const n=['UserStories','GWT','FR','SC','假设','边界'];let f=0;r.forEach((x,i)=>{if(!x.test(tpl)){console.error('MISS:'+n[i]);f=1}});if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 9 类歧义自检列表 + `[ASSUMPTION: ...]` 标记 + "方向性"决策提问原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){console.error('NO 执行流程');process.exit(1)}const t=c.substring(idx);const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!t.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!t.includes('ASSUMPTION')){console.error('NO ASSUMPTION');process.exit(1)}if(!t.includes('方向性')){console.error('NO 方向性');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内 PRD 模板包含 `OKR 对齐` 章节，含 KR + 进度 + 推进三字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){console.error('NO 执行流程');process.exit(1)}const t=c.substring(idx);if(!t.includes('OKR 对齐')){console.error('NO OKR');process.exit(1)}if(!t.includes('KR')||!t.includes('进度')||!t.includes('推进')){console.error('INCOMPLETE');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符（`请用户确认`/`待用户回答`/`等待用户`）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
