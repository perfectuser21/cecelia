# Sprint Contract Draft (Round 1)

## Feature 1: Backend — system_prompt_content 字段

**行为描述**:
请求 `/api/brain/harness/pipeline-detail?planner_task_id=xxx` 时，返回的每个 step 对象新增 `system_prompt_content` 字段，值为该步骤对应 skill 的 SKILL.md 文件全文内容。task_type 到 skill 名称的映射规则：`harness_planner` → `harness-planner`，`harness_contract_propose` → `harness-contract-proposer`，`harness_contract_review` → `harness-contract-reviewer`，`harness_generate` → `harness-generator`，`harness_evaluate` → `harness-evaluator`，`harness_report` → `harness-report`。skill 不存在或 SKILL.md 不存在时，字段值为 `null`。

**硬阈值**:
- 每个 step 对象必须包含 `system_prompt_content` 字段（string | null）
- 当 skill SKILL.md 文件存在时，`system_prompt_content` 的长度 > 100（SKILL.md 不会少于 100 字符）
- 当 task_type 无法映射到 skill 时，`system_prompt_content` 为 `null`（不报错）
- 响应时间不因读取 SKILL.md 显著退化（< 3s）

**验证命令**:
```bash
# Happy path：验证 system_prompt_content 字段存在且有内容
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!data.steps || !Array.isArray(data.steps)) throw new Error('FAIL: steps 不是数组');
    const step = data.steps[0];
    if (!('system_prompt_content' in step)) throw new Error('FAIL: 缺少 system_prompt_content 字段');
    if (step.system_prompt_content && step.system_prompt_content.length < 100) throw new Error('FAIL: SKILL.md 内容过短');
    console.log('PASS: system_prompt_content 字段存在，长度=' + (step.system_prompt_content?.length || 'null'));
  "

# 多步骤验证：所有 step 都有该字段
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const missing = data.steps.filter(s => !('system_prompt_content' in s));
    if (missing.length > 0) throw new Error('FAIL: ' + missing.length + ' 个 step 缺少 system_prompt_content');
    const withContent = data.steps.filter(s => s.system_prompt_content && s.system_prompt_content.length > 100);
    console.log('PASS: 全部 ' + data.steps.length + ' 个 step 都有字段，其中 ' + withContent.length + ' 个有实际内容');
  "
```

---

## Feature 2: 节点卡片布局（Pipeline 详情页改版）

**行为描述**:
`/harness-pipeline/:id` 页面的步骤展示从折叠列表改为卡片布局。每张卡片显示：步骤名称（label）、状态图标、verdict 徽章（如有）、耗时。卡片可点击，点击后导航到该步骤的独立详情子页面 `/harness-pipeline/:id/step/:step`。Stage Timeline 保持不变。

**硬阈值**:
- 每个 step 渲染为一个独立的可点击卡片元素（非折叠列表）
- 卡片展示 label、status icon、verdict badge、duration 四项信息
- 点击卡片触发路由导航到 `/harness-pipeline/:id/step/:stepNumber`
- 卡片使用 `cursor-pointer` 样式表示可交互

**验证命令**:
```bash
# 验证卡片组件存在且可点击
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx', 'utf8');
  const hasClickHandler = code.includes('onClick') && code.includes('/step/');
  if (!hasClickHandler) throw new Error('FAIL: 卡片缺少点击导航到 /step/ 的处理');
  const hasCursorPointer = code.includes('cursor-pointer');
  if (!hasCursorPointer) throw new Error('FAIL: 卡片缺少 cursor-pointer 样式');
  console.log('PASS: 卡片布局包含点击导航和交互样式');
"

# 验证不再使用折叠展开（移除旧模式）
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx', 'utf8');
  const hasCollapse = /expandedStep|toggleExpand|isExpanded/.test(code);
  if (hasCollapse) throw new Error('FAIL: 仍存在折叠展开逻辑，应已移除');
  console.log('PASS: 折叠展开逻辑已清除，改为卡片导航');
"
```

---

## Feature 3: 步骤详情子页面（Node Detail View）

**行为描述**:
新增路由 `/harness-pipeline/:id/step/:step`，对应独立页面组件。页面展示三个全量内容区块：
1. **User Input** — 该步骤的 `input_content`
2. **System Prompt** — 该步骤的 `system_prompt_content`（SKILL.md 全文）
3. **Output** — 该步骤的 `output_content`

三个区块使用等宽字体（`font-mono` / `whitespace-pre-wrap`）全量展示，支持自然滚动，不截断。无内容时显示「暂无数据」。页面顶部有返回按钮，可回到 Pipeline 详情页。

**硬阈值**:
- 路由 `/harness-pipeline/:id/step/:step` 已注册且可访问
- 页面包含三个区块，分别标题为 User Input / System Prompt / Output
- 每个区块使用等宽字体（`font-mono` 或 `monospace`）
- 无内容时显示「暂无数据」占位文字
- 页面有返回按钮，点击导航回 `/harness-pipeline/:id`

**验证命令**:
```bash
# 验证子页面组件文件存在且包含三个区块
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src/pages/harness-pipeline');
  const stepPage = files.find(f => /Step|NodeDetail/i.test(f) && f.endsWith('.tsx'));
  if (!stepPage) throw new Error('FAIL: 缺少步骤详情子页面组件文件');
  const code = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/' + stepPage, 'utf8');
  const hasInput = /User\s*Input/i.test(code);
  const hasPrompt = /System\s*Prompt/i.test(code);
  const hasOutput = /Output/i.test(code);
  if (!hasInput || !hasPrompt || !hasOutput) throw new Error('FAIL: 缺少三栏区块标题（Input/Prompt/Output）');
  console.log('PASS: 步骤详情页包含三个区块');
"

# 验证等宽字体和暂无数据占位
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src/pages/harness-pipeline');
  const stepPage = files.find(f => /Step|NodeDetail/i.test(f) && f.endsWith('.tsx'));
  const code = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/' + stepPage, 'utf8');
  const hasMono = code.includes('font-mono') || code.includes('monospace');
  if (!hasMono) throw new Error('FAIL: 缺少等宽字体样式');
  const hasPlaceholder = code.includes('暂无数据');
  if (!hasPlaceholder) throw new Error('FAIL: 缺少暂无数据占位');
  console.log('PASS: 等宽字体 + 暂无数据占位正确');
"

# 验证路由已注册
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('apps/api/features/execution/index.ts', 'utf8');
  const hasStepRoute = code.includes('/step/') || code.includes(':step');
  if (!hasStepRoute) throw new Error('FAIL: 路由配置中缺少 /step/:step 子路由');
  console.log('PASS: 步骤详情子路由已注册');
"

# 验证返回按钮
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src/pages/harness-pipeline');
  const stepPage = files.find(f => /Step|NodeDetail/i.test(f) && f.endsWith('.tsx'));
  const code = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/' + stepPage, 'utf8');
  const hasBack = /navigate\(.*harness-pipeline/i.test(code) || /useNavigate|navigate\(-1\)/.test(code);
  if (!hasBack) throw new Error('FAIL: 缺少返回按钮导航逻辑');
  console.log('PASS: 返回按钮存在');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — system_prompt_content 字段

**范围**: `packages/brain/src/routes/harness.js` 中 `buildSteps` 函数新增 `system_prompt_content` 字段读取逻辑。包含 task_type → skill 名称映射、SKILL.md 文件读取、错误容忍（文件不存在返回 null）。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] pipeline-detail API 每个 step 返回 system_prompt_content 字段，值为对应 SKILL.md 全文或 null
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const s=d.steps[0];if(!('system_prompt_content' in s))throw new Error('FAIL');console.log('PASS: len='+(s.system_prompt_content?.length||'null'))"
- [ ] [BEHAVIOR] 未知 task_type 不报错，system_prompt_content 返回 null
  Test: node -e "const m={'harness_planner':'harness-planner'};const r=m['unknown_type']||null;if(r!==null)throw new Error('FAIL');console.log('PASS: 未知类型返回 null')"

### Workstream 2: Frontend — 卡片布局 + 步骤详情子页面

**范围**: 三个改动点：(1) `apps/api/features/execution/index.ts` 新增 `/harness-pipeline/:id/step/:step` 路由配置；(2) `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 步骤列表改为卡片布局、移除折叠展开；(3) 新增 `HarnessPipelineStepPage.tsx` 步骤详情子页面（三栏全量展示 + 返回按钮 + 暂无数据占位）。同时在 `apps/api/features/execution/pages/` 和 `apps/api/features/execution/index.ts` 注册新页面组件。
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后（前端需要 system_prompt_content 字段）

**DoD**:
- [ ] [ARTIFACT] 步骤详情子页面组件文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 卡片点击导航到 /harness-pipeline/:id/step/:step
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('cursor-pointer')||!c.includes('/step/'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 步骤详情页包含 User Input / System Prompt / Output 三栏，等宽字体，暂无数据占位
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');if(!/User\s*Input/i.test(c)||!/System\s*Prompt/i.test(c)||!c.includes('font-mono')||!c.includes('暂无数据'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 路由 /harness-pipeline/:id/step/:step 已在 execution feature 注册
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');if(!c.includes(':step'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 步骤详情页有返回按钮可回到 Pipeline 详情页
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');if(!/navigate/.test(c))throw new Error('FAIL');console.log('PASS')"
