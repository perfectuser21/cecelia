# Sprint Contract Draft (Round 3)

> PRD: Pipeline 步骤详情：Input / Prompt / Output 三栏视图
> Planner Task: 98503cee-f277-4690-8254-fb9058b5dee3

---

## Feature 1: 串行步骤列表 — API 返回 steps 数组

**行为描述**:
用户请求 `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx` 时，响应中包含 `steps` 数组。每个元素代表一个已执行步骤，包含 `step`（序号，从 1 开始）、`task_id`、`task_type`、`label`（人类可读标签，如 "Planner"、"Propose R1"、"Review R2"）、`status`、`created_at`、`completed_at`。steps 按 `created_at` 升序排列，同类型多次出现时 label 带轮次编号。

**硬阈值**:
- `steps` 字段为非 null 数组，长度 ≥ 1（至少包含 Planner 步骤）
- 每个 step 元素必须包含 `step`（number）、`task_id`（string）、`task_type`（string）、`label`（string）、`status`（string）六个字段
- `step` 值从 1 开始递增，无跳跃
- 多轮 Propose/Review 时，label 必须含轮次标记（如 "Propose R1"、"Review R2"），不能全部标记为 "Propose"
- steps 按 `created_at` 升序排列（steps[0].created_at ≤ steps[1].created_at ≤ ...）

**验证命令**:
```bash
# Happy path: steps 数组存在且结构正确
PLANNER_ID="98503cee-f277-4690-8254-fb9058b5dee3"
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(d.steps)) throw new Error('FAIL: steps 不是数组');
    if (d.steps.length < 1) throw new Error('FAIL: steps 为空');
    const required = ['step','task_id','task_type','label','status'];
    d.steps.forEach((s, i) => {
      required.forEach(k => {
        if (s[k] === undefined || s[k] === null) throw new Error('FAIL: steps['+i+'] 缺少 '+k);
      });
      if (typeof s.step !== 'number') throw new Error('FAIL: steps['+i+'].step 不是 number');
      if (s.step !== i + 1) throw new Error('FAIL: steps['+i+'].step=' + s.step + ' 期望 ' + (i+1));
    });
    console.log('PASS: steps 数组有 ' + d.steps.length + ' 个元素，字段完整，序号连续');
  "

# 轮次标签验证: Propose/Review 多轮时 label 必须含轮次编号
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const proposeSteps = d.steps.filter(s => s.task_type.includes('propose'));
    if (proposeSteps.length > 1) {
      const labels = proposeSteps.map(s => s.label);
      const unique = new Set(labels);
      if (unique.size !== labels.length) throw new Error('FAIL: 多轮 Propose label 重复: ' + labels.join(', '));
      proposeSteps.forEach(s => {
        if (!/R\d+/.test(s.label)) throw new Error('FAIL: Propose label 缺少轮次编号: ' + s.label);
      });
      console.log('PASS: ' + proposeSteps.length + ' 个 Propose 步骤 label 均不同且含轮次: ' + labels.join(', '));
    } else {
      console.log('PASS: 仅 ' + proposeSteps.length + ' 个 Propose 步骤，无需多轮标签');
    }
  "

# 升序验证: steps 按 created_at 排列
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    for (let i = 1; i < d.steps.length; i++) {
      const prev = d.steps[i-1].created_at;
      const curr = d.steps[i].created_at;
      if (prev && curr && new Date(prev) > new Date(curr)) {
        throw new Error('FAIL: steps[' + (i-1) + '].created_at > steps[' + i + '].created_at');
      }
    }
    console.log('PASS: ' + d.steps.length + ' 个步骤按 created_at 升序排列');
  "
```

---

## Feature 2: 三栏钻取视图 — 每步的 Input/Prompt/Output 内容

**行为描述**:
`pipeline-detail` API 的每个 step 额外包含三个字段：`input_content`（该步骤的输入数据）、`prompt_content`（发给 AI 的完整 prompt）、`output_content`（AI 产出的文件内容）。三个字段均为 string 或 null。Planner 步骤的 input_content 包含用户原始需求（task.description），output_content 包含 sprint-prd.md 内容。Propose 步骤的 input_content 包含 sprint-prd.md 内容。Review 步骤的 input_content 包含 contract-draft.md 内容。

**硬阈值**:
- 每个 step 必须包含 `input_content`、`prompt_content`、`output_content` 三个字段（值可为 null）
- Planner 步骤（task_type 含 "planner"）的 `input_content` 不为 null（至少有用户需求描述）
- `prompt_content` 重建后必须包含 skill 名称前缀（如 "/harness-planner"、"/harness-contract-proposer"）
- `prompt_content` 包含 task_id 和 sprint_dir 参数

**验证命令**:
```bash
# 三栏字段存在性验证
PLANNER_ID="98503cee-f277-4690-8254-fb9058b5dee3"
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const fields = ['input_content','prompt_content','output_content'];
    d.steps.forEach((s, i) => {
      fields.forEach(f => {
        if (!(f in s)) throw new Error('FAIL: steps['+i+'] 缺少字段 '+f);
      });
    });
    console.log('PASS: 所有 ' + d.steps.length + ' 个步骤均包含三栏字段');
  "

# Planner 步骤 input_content 非空验证
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const planner = d.steps.find(s => s.task_type && s.task_type.includes('planner'));
    if (!planner) throw new Error('FAIL: 未找到 Planner 步骤');
    if (!planner.input_content || planner.input_content.trim().length < 10) {
      throw new Error('FAIL: Planner input_content 为空或过短: ' + JSON.stringify(planner.input_content));
    }
    console.log('PASS: Planner input_content 长度 ' + planner.input_content.length + ' 字符');
  "

# prompt_content 重建验证: 包含 skill 名和 task_id
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const withPrompt = d.steps.filter(s => s.prompt_content);
    if (withPrompt.length === 0) throw new Error('FAIL: 没有任何步骤有 prompt_content');
    withPrompt.forEach(s => {
      if (!s.prompt_content.includes('/harness-') && !s.prompt_content.includes('/sprint-')) {
        throw new Error('FAIL: step ' + s.step + ' prompt 缺少 skill 名前缀');
      }
      if (!s.prompt_content.includes(s.task_id)) {
        throw new Error('FAIL: step ' + s.step + ' prompt 不包含 task_id');
      }
    });
    console.log('PASS: ' + withPrompt.length + ' 个步骤的 prompt_content 包含 skill 名和 task_id');
  "

# 边界: 不存在的 planner_task_id 返回空 steps
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(d.steps)) throw new Error('FAIL: 无效 ID 时 steps 应为数组');
    if (d.steps.length > 0) throw new Error('FAIL: 无效 ID 返回了 ' + d.steps.length + ' 个步骤');
    console.log('PASS: 不存在的 planner_task_id 返回空 steps 数组');
  "
```

---

## Feature 3: 前端步骤列表 + 三栏展开视图

**行为描述**:
HarnessPipelineDetailPage 页面主体区域显示串行步骤列表。每个步骤行显示序号、类型标签、状态图标、耗时。点击步骤行展开三栏视图（Input | Prompt | Output），每栏带标题，内容用等宽字体渲染，支持滚动。同时只能展开一个步骤（手风琴模式）。无内容的栏显示"暂无数据"。

**硬阈值**:
- 页面从 `pipeline-detail` API 获取 `steps` 数组并渲染步骤列表
- 每个步骤行包含序号、label 文字、状态标记
- 点击步骤行展开三栏区域，再次点击收起
- 三栏标题分别为 "Input"、"Prompt"、"Output"
- 内容区域使用等宽字体（CSS font-family 含 monospace）
- 无内容栏显示"暂无数据"文字
- 手风琴模式：展开新步骤时自动收起已展开的步骤

**验证命令**:
```bash
# ARTIFACT: HarnessPipelineDetailPage.tsx 文件存在且包含 steps 渲染逻辑
node -e "
  const fs = require('fs');
  const path = 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx';
  const content = fs.readFileSync(path, 'utf8');
  if (!content.includes('steps')) throw new Error('FAIL: 文件未引用 steps');
  if (!content.includes('input_content') && !content.includes('inputContent') && !content.includes('input')) {
    throw new Error('FAIL: 文件未引用 input 相关字段');
  }
  if (!content.includes('prompt_content') && !content.includes('promptContent') && !content.includes('prompt')) {
    throw new Error('FAIL: 文件未引用 prompt 相关字段');
  }
  if (!content.includes('output_content') && !content.includes('outputContent') && !content.includes('output')) {
    throw new Error('FAIL: 文件未引用 output 相关字段');
  }
  console.log('PASS: HarnessPipelineDetailPage.tsx 包含三栏字段引用');
"

# BEHAVIOR: 组件包含手风琴状态管理 + 暂无数据 fallback
node -e "
  const content = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx', 'utf8');
  // 验证手风琴模式：状态变量控制展开/收起
  if (!content.includes('useState') || (!content.includes('expanded') && !content.includes('activeStep') && !content.includes('openStep'))) {
    throw new Error('FAIL: 缺少展开/收起状态管理（期望 useState + expanded/activeStep/openStep）');
  }
  // 验证暂无数据 fallback
  if (!content.includes('暂无数据')) {
    throw new Error('FAIL: 缺少\"暂无数据\"占位文字');
  }
  // 验证等宽字体
  if (!content.includes('monospace') && !content.includes('mono')) {
    throw new Error('FAIL: 缺少等宽字体设置（monospace）');
  }
  console.log('PASS: 手风琴状态管理 + 暂无数据 + monospace 均存在');
"

# BEHAVIOR: 步骤列表渲染 label 和状态
node -e "
  const content = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx', 'utf8');
  if (!content.includes('label')) throw new Error('FAIL: 未渲染 label');
  if (!content.includes('status')) throw new Error('FAIL: 未渲染 status');
  // 三栏标题
  const hasInput = content.includes('Input');
  const hasPrompt = content.includes('Prompt');
  const hasOutput = content.includes('Output');
  if (!hasInput || !hasPrompt || !hasOutput) {
    throw new Error('FAIL: 缺少三栏标题 Input/Prompt/Output');
  }
  console.log('PASS: label + status + 三栏标题 Input/Prompt/Output 均存在');
"
```

---

## Feature 4: Prompt 重建逻辑正确性

**行为描述**:
Backend 的 prompt 重建函数复用 executor.js 中 preparePrompt 的参数组装逻辑（skill 名 + task_id + sprint_dir + 业务参数）。每种 task_type 的 prompt 格式与 executor.js 一致：Planner 包含 "/harness-planner" + task_id + sprint_dir + description；Proposer 包含 propose_round + planner_task_id；Reviewer 包含 propose_branch + planner_branch；Generator 包含 contract_branch。

**硬阈值**:
- Planner 步骤的 prompt_content 首行包含 "/harness-planner" 或 "/sprint-planner"
- Proposer 步骤的 prompt_content 包含 "propose_round" 和 "planner_task_id"
- Reviewer 步骤的 prompt_content 包含 "propose_task_id" 或 "propose_branch"
- prompt_content 包含 "sprint_dir" 参数

**验证命令**:
```bash
# Prompt 格式与 executor.js 一致性验证
PLANNER_ID="98503cee-f277-4690-8254-fb9058b5dee3"
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const planner = d.steps.find(s => s.task_type && s.task_type.includes('planner'));
    if (planner && planner.prompt_content) {
      if (!/\/(harness|sprint)-planner/.test(planner.prompt_content)) {
        throw new Error('FAIL: Planner prompt 缺少 skill 名');
      }
      if (!planner.prompt_content.includes('sprint_dir')) {
        throw new Error('FAIL: Planner prompt 缺少 sprint_dir');
      }
      console.log('PASS: Planner prompt 格式正确');
    } else {
      console.log('PASS: 无 Planner 步骤或无 prompt（允许）');
    }
    const proposer = d.steps.find(s => s.task_type && s.task_type.includes('propose'));
    if (proposer && proposer.prompt_content) {
      if (!proposer.prompt_content.includes('propose_round')) {
        throw new Error('FAIL: Proposer prompt 缺少 propose_round');
      }
      if (!proposer.prompt_content.includes('planner_task_id')) {
        throw new Error('FAIL: Proposer prompt 缺少 planner_task_id');
      }
      console.log('PASS: Proposer prompt 格式正确');
    } else {
      console.log('PASS: 无 Proposer 步骤或无 prompt（允许）');
    }
  "

# 负向验证: prompt 不应包含未替换的模板变量
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.steps.forEach(s => {
      if (s.prompt_content) {
        if (/\\\$\{[A-Z_]+\}/.test(s.prompt_content) || /\{[A-Z_]+\}/.test(s.prompt_content)) {
          throw new Error('FAIL: step ' + s.step + ' prompt 含未替换模板变量: ' + s.prompt_content.substring(0, 200));
        }
      }
    });
    console.log('PASS: 所有 prompt 无未替换的模板变量');
  "
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — steps 构建 + prompt 重建

**范围**: `packages/brain/src/routes/harness.js` 的 `pipeline-detail` 端点，新增 `steps` 数组构建逻辑和 prompt 重建函数。从已查询的 tasks 中按 created_at 排序，为每个 task 生成 step 对象。prompt 重建逻辑参考 executor.js preparePrompt，使用 task.payload 中的参数重新组装。input_content 和 output_content 通过 git show 或文件系统读取。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] pipeline-detail API 返回 steps 数组，每个元素包含 step/task_id/task_type/label/status/created_at/completed_at 七个字段，按 created_at 升序排列
  Test: bash -c 'curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); if(!Array.isArray(d.steps)||d.steps.length<1) throw new Error(\"FAIL\"); d.steps.forEach((s,i)=>{[\"step\",\"task_id\",\"task_type\",\"label\",\"status\"].forEach(k=>{if(s[k]===undefined) throw new Error(\"FAIL: \"+k)}); if(s.step!==i+1) throw new Error(\"FAIL: seq\")}); console.log(\"PASS: \"+d.steps.length+\" steps\")"'
- [ ] [BEHAVIOR] 每个 step 包含 input_content/prompt_content/output_content 三个字段（值可为 null），Planner 步骤的 input_content 非空
  Test: bash -c 'curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); d.steps.forEach((s,i)=>{[\"input_content\",\"prompt_content\",\"output_content\"].forEach(f=>{if(!(f in s)) throw new Error(\"FAIL: \"+f)})}); const p=d.steps.find(s=>s.task_type.includes(\"planner\")); if(p&&!p.input_content) throw new Error(\"FAIL: planner input null\"); console.log(\"PASS\")"'
- [ ] [BEHAVIOR] prompt_content 重建与 executor.js 格式一致（含 skill 名前缀 + task_id + sprint_dir）
  Test: bash -c 'curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); const s=d.steps.find(s=>s.prompt_content); if(!s) throw new Error(\"FAIL: no prompt\"); if(!s.prompt_content.includes(\"/harness-\")&&!s.prompt_content.includes(\"/sprint-\")) throw new Error(\"FAIL: no skill\"); console.log(\"PASS\")"'
- [ ] [BEHAVIOR] Propose/Review 多轮时 label 含轮次编号（如 "Propose R1"、"Review R2"），不重复
  Test: bash -c 'curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")); const ps=d.steps.filter(s=>s.task_type.includes(\"propose\")); if(ps.length>1){const u=new Set(ps.map(s=>s.label)); if(u.size!==ps.length) throw new Error(\"FAIL: dup labels\")}; console.log(\"PASS: \"+ps.length+\" propose steps\")"'

### Workstream 2: Frontend — 步骤列表 + 三栏手风琴视图

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`，重写主体组件。从 API 获取 steps 数据，渲染串行步骤列表。每行可点击展开三栏 Input | Prompt | Output，手风琴模式。内容用 `<pre>` 等宽字体渲染，无内容显示"暂无数据"。
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后（API 需返回 steps）

**DoD**:
- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 引用 steps 数组并渲染步骤列表
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('steps')) throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 三栏区域包含 Input/Prompt/Output 标题，使用 monospace 字体，无内容显示"暂无数据"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('Input')||!c.includes('Prompt')||!c.includes('Output')) throw new Error('FAIL: title'); if(!c.includes('monospace')&&!c.includes('mono')) throw new Error('FAIL: font'); if(!c.includes('暂无数据')) throw new Error('FAIL: fallback'); console.log('PASS')"
- [ ] [BEHAVIOR] 手风琴模式：使用 useState 管理展开状态，同时只展开一个步骤
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('useState')) throw new Error('FAIL: no useState'); if(!c.includes('expanded')&&!c.includes('activeStep')&&!c.includes('openStep')&&!c.includes('selectedStep')) throw new Error('FAIL: no expand state'); console.log('PASS')"
