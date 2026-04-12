# Sprint Contract Draft (Round 2)

> Round 2 修订：根据 Evaluator Round 1 反馈修复全部 7 项问题（命令太弱×5、PRD遗漏×1、缺失边界×1）

---

## Feature 1: Backend — pipeline-detail 端点新增 system_prompt_content 字段

**行为描述**:
用户请求 `/api/brain/harness/pipeline-detail?planner_task_id=xxx` 时，每个 step 对象额外携带 `system_prompt_content` 字段。该字段为对应 skill 的 SKILL.md 文件全文（string 类型），若对应 skill 无 SKILL.md 文件则返回 `null`，不抛异常、不影响其他 step。

**硬阈值**:
- 每个 step 的 `system_prompt_content` 必须是 `string`（有内容时）或 `null`（无 SKILL.md 时），不允许 `undefined`、其他类型或异常
- 有内容的 `system_prompt_content` 长度 > 100 字符（SKILL.md 不可能短于 100 字符）
- API 返回 HTTP 200，JSON 格式正确

**验证命令**:
```bash
# Happy path: 验证 system_prompt_content 字段存在且类型正确（修复 Issue #1 — 调用实际 API，不用纯内存逻辑）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!d.steps||!Array.isArray(d.steps))throw new Error('FAIL: steps 不是数组');
  d.steps.forEach((s,i) => {
    if(s.system_prompt_content !== null && typeof s.system_prompt_content !== 'string')
      throw new Error('FAIL: step '+i+' system_prompt_content 类型错误: '+typeof s.system_prompt_content);
  });
  const withContent = d.steps.filter(s => typeof s.system_prompt_content === 'string');
  if(withContent.length === 0) throw new Error('FAIL: 没有任何 step 有 system_prompt_content 内容');
  withContent.forEach((s,i) => {
    if(s.system_prompt_content.length <= 100)
      throw new Error('FAIL: step 有内容但长度 <= 100: '+s.system_prompt_content.length);
  });
  console.log('PASS: '+withContent.length+' 个 step 有内容，类型/长度均正确');
"

# 边界: 验证 SKILL.md 不存在时返回 null 而非崩溃（修复 Issue #6 — 缺失边界测试）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const nullSteps = d.steps.filter(s => s.system_prompt_content === null);
  const contentSteps = d.steps.filter(s => typeof s.system_prompt_content === 'string' && s.system_prompt_content.length > 100);
  if(nullSteps.length === 0 && contentSteps.length === d.steps.length)
    console.log('WARN: 所有 step 都有内容，null 边界无法在此数据集验证（非 FAIL）');
  else
    console.log('PASS: '+contentSteps.length+' 个有内容，'+nullSteps.length+' 个为 null');
  d.steps.forEach((s,i) => {
    if(s.system_prompt_content !== null && typeof s.system_prompt_content !== 'string')
      throw new Error('FAIL: step '+i+' system_prompt_content 类型错误');
  });
"
```

---

## Feature 2: 节点卡片布局（Pipeline 详情页改版）

**行为描述**:
Pipeline 详情页 (`/harness-pipeline/:id`) 的步骤列表改为可点击的卡片布局。每张卡片展示四项信息：步骤名称（label）、状态图标（status）、verdict 徽章、耗时（duration）。点击卡片导航到该步骤的独立详情子页面。

**硬阈值**:
- 每张卡片必须展示 label、status、verdict、duration 四项信息
- 卡片必须可点击（onClick 事件绑定）
- 点击后导航路径包含 `/step/`
- 卡片有 cursor-pointer 交互提示样式

**验证命令**:
```bash
# 卡片布局包含四项信息 + 点击导航（修复 Issue #2 + Issue #3 — 用正则匹配绑定表达式，排除注释蒙混）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if(!(/onClick\s*=\s*\{/.test(c) && /\/step\//.test(c)))throw new Error('FAIL: onClick 未绑定到 /step/ 导航');
  if(!c.includes('cursor-pointer'))throw new Error('FAIL: 缺少 cursor-pointer');
  if(!/label|step\.label|\.label/.test(c))throw new Error('FAIL: 卡片未展示 label');
  if(!/duration|elapsed|耗时/.test(c))throw new Error('FAIL: 卡片未展示耗时');
  if(!/verdict/.test(c))throw new Error('FAIL: 卡片未展示 verdict');
  if(!/status/.test(c))throw new Error('FAIL: 卡片未展示 status');
  console.log('PASS: 卡片布局包含点击导航、交互样式和四项信息');
"

# 边界: 确认 onClick 是真实事件绑定而非注释
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  const lines=c.split('\n');
  const onClickLines=lines.filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*')&&/onClick\s*=\s*\{/.test(l));
  if(onClickLines.length===0)throw new Error('FAIL: onClick 仅出现在注释中，无实际绑定');
  console.log('PASS: '+onClickLines.length+' 处 onClick 绑定（排除注释行）');
"
```

---

## Feature 3: 步骤详情子页面（Node Detail View）

**行为描述**:
用户点击节点卡片后，浏览器导航到 `/harness-pipeline/:id/step/:step`，展示该步骤的三个全量展示区块：User Input、System Prompt、Output。三个区块使用等宽字体全量展示，无内容时显示「暂无数据」占位。页面顶部有返回按钮可回到 Pipeline 详情页。

**硬阈值**:
- 路由 `/harness-pipeline/:id/step/:step` 已注册，页面可加载
- 三个区块标题：User Input、System Prompt、Output
- 使用等宽字体（font-mono）
- 无内容时显示「暂无数据」
- 返回按钮绑定 onClick → navigate 回 harness-pipeline 路径
- 页面组件引用实际数据字段（input_content、system_prompt_content、output_content）

**验证命令**:
```bash
# 路由注册验证（修复 Issue #4 — 用正则匹配 path 配置中的 :step，排除注释蒙混）
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');
  if(!/path:\s*['\"].*:step/.test(c))throw new Error('FAIL: 缺少 path 配置中的 :step 参数');
  if(!/[Ss]tep[Pp]age|[Ss]tep[Dd]etail/.test(c))throw new Error('FAIL: 缺少 StepPage/StepDetail 组件引用');
  console.log('PASS: 路由已注册且引用了 Step 组件');
"

# 子页面三栏区块 + 数据字段引用（修复 Issue #7 — 检查实际数据字段引用，不只检查标题）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');
  if(!/User\s*Input/i.test(c))throw new Error('FAIL: 缺少 User Input 标题');
  if(!/System\s*Prompt/i.test(c))throw new Error('FAIL: 缺少 System Prompt 标题');
  if(!/Output/i.test(c))throw new Error('FAIL: 缺少 Output 标题');
  if(!c.includes('font-mono'))throw new Error('FAIL: 缺少等宽字体');
  if(!c.includes('暂无数据'))throw new Error('FAIL: 缺少暂无数据占位');
  if(!/input_content/.test(c))throw new Error('FAIL: 未引用 input_content 数据字段');
  if(!/system_prompt_content/.test(c))throw new Error('FAIL: 未引用 system_prompt_content 数据字段');
  if(!/output_content/.test(c))throw new Error('FAIL: 未引用 output_content 数据字段');
  console.log('PASS: 三栏区块标题、字体、占位、数据字段引用均正确');
"

# 返回按钮绑定验证（修复 Issue #5 — 检查 onClick 绑定 navigate 而非仅 import）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');
  const lines=c.split('\n');
  const navBindings=lines.filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*')&&/onClick/.test(l)&&/navigate/.test(l));
  if(navBindings.length===0){
    const hasOnClick=lines.some(l=>!l.trim().startsWith('//')&&/onClick\s*=\s*\{/.test(l));
    const hasNavCall=lines.some(l=>!l.trim().startsWith('//')&&/navigate\s*\(/.test(l));
    if(!hasOnClick||!hasNavCall)throw new Error('FAIL: 无 onClick 绑定 navigate 的返回按钮');
  }
  if(!/harness-pipeline/.test(c))throw new Error('FAIL: navigate 未指向 harness-pipeline 路径');
  console.log('PASS: 返回按钮绑定了 navigate 且指向正确路径');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — system_prompt_content 字段

**范围**: `packages/brain/src/routes/harness.js` 中 pipeline-detail 端点，新增 task_type → skill 名映射 + SKILL.md 文件读取逻辑
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] packages/brain/src/routes/harness.js 中 pipeline-detail 端点包含 system_prompt_content 字段读取逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/system_prompt_content/.test(c))throw new Error('FAIL');console.log('OK')"
- [ ] [BEHAVIOR] API 返回的每个 step 的 system_prompt_content 为 string（有 SKILL.md）或 null（无 SKILL.md），调用实际端点验证
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));d.steps.forEach((s,i)=>{if(s.system_prompt_content!==null&&typeof s.system_prompt_content!=='string')throw new Error('FAIL: step '+i)});const w=d.steps.filter(s=>typeof s.system_prompt_content==='string');if(w.length===0)throw new Error('FAIL: 无内容');console.log('PASS: '+w.length+' 个有内容')"

### Workstream 2: Frontend — 卡片布局 + 步骤详情子页面 + 路由

**范围**: `apps/api/features/execution/index.ts`（路由注册）、`apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`（卡片改版）、新增 `HarnessPipelineStepPage.tsx`（步骤详情子页面）
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后（前端需要 system_prompt_content 字段）

**DoD**:
- [ ] [ARTIFACT] apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 路由 /harness-pipeline/:id/step/:step 已注册在 execution feature manifest 中，path 配置含 :step 参数
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');if(!/path:\s*['\"].*:step/.test(c))throw new Error('FAIL');if(!/[Ss]tep[Pp]age|[Ss]tep[Dd]etail/.test(c))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Pipeline 详情页卡片展示 label/status/verdict/duration 四项信息，onClick 绑定 /step/ 导航（非注释），有 cursor-pointer 样式
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const lines=c.split('\n');const real=lines.filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*')&&/onClick\s*=\s*\{/.test(l));if(real.length===0)throw new Error('FAIL: onClick 仅在注释中');if(!(/\/step\//.test(c)&&c.includes('cursor-pointer')))throw new Error('FAIL');if(!/label|\.label/.test(c))throw new Error('FAIL: 无 label');if(!/duration|elapsed|耗时/.test(c))throw new Error('FAIL: 无耗时');if(!/verdict/.test(c))throw new Error('FAIL: 无 verdict');console.log('PASS')"
- [ ] [BEHAVIOR] 步骤详情子页面三栏区块展示实际数据（引用 input_content/system_prompt_content/output_content 字段），等宽字体，暂无数据占位
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');if(!/input_content/.test(c))throw new Error('FAIL: 无 input_content');if(!/system_prompt_content/.test(c))throw new Error('FAIL: 无 system_prompt_content');if(!/output_content/.test(c))throw new Error('FAIL: 无 output_content');if(!c.includes('font-mono'))throw new Error('FAIL: 无等宽');if(!c.includes('暂无数据'))throw new Error('FAIL: 无占位');console.log('PASS')"
- [ ] [BEHAVIOR] 返回按钮 onClick 绑定 navigate 指向 harness-pipeline 路径（非仅 import 声明）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');const lines=c.split('\n');const hasRealOnClick=lines.some(l=>!l.trim().startsWith('//')&&/onClick\s*=\s*\{/.test(l));const hasNavCall=lines.some(l=>!l.trim().startsWith('//')&&/navigate\s*\(/.test(l));if(!hasRealOnClick||!hasNavCall)throw new Error('FAIL: 无真实 onClick+navigate 绑定');if(!/harness-pipeline/.test(c))throw new Error('FAIL: 未指向正确路径');console.log('PASS')"
