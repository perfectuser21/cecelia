# Sprint Contract Draft (Round 4)

> PRD: Pipeline 步骤详情 Input/Prompt/Output 三栏视图
> Round 4: 修复 Reviewer R3 反馈的 3 条必须修改项 + 3 条可选改进

---

## Feature 1: 串行步骤列表 — pipeline-detail API 返回 steps 数组

**行为描述**:
用户请求 `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx`，响应包含 `steps` 数组。每个步骤包含 `step`（序号）、`task_id`、`task_type`、`label`（人类可读标签，多轮时含轮次如 "Propose R1"）、`status`、`created_at`、`completed_at`。步骤按 `created_at` 升序排列。

**硬阈值**:
- 每个 step 对象必须包含 7 个必填字段：`step`, `task_id`, `task_type`, `label`, `status`, `created_at`, `completed_at`
- steps 数组按 `created_at` 升序排列（每个 step 的 `created_at` 必须存在且不为 null）
- label 对同类型多次出现的步骤添加轮次编号（"Propose R1", "Propose R2"）
- 同一 pipeline 内 label 不重复（同类型多轮通过 R1/R2 区分）

**验证命令**:
```bash
# Triple 1.1: 必填字段完整性（7个字段 + created_at/completed_at 均验证）
PLANNER_ID="98503cee-f277-4690-8254-fb9058b5dee3"
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!d.steps || d.steps.length === 0) throw new Error('FAIL: steps 为空');
    const required = ['step','task_id','task_type','label','status','created_at','completed_at'];
    d.steps.forEach((s, i) => {
      required.forEach(f => {
        if (s[f] === undefined || s[f] === null) throw new Error('FAIL: steps['+i+'] 缺少字段 '+f);
      });
    });
    console.log('PASS: '+d.steps.length+' 个步骤，7个必填字段（含 created_at/completed_at）均存在');
  "

# Triple 1.2: created_at 升序排列（先验证每步 created_at 非空，再验证排序）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (d.steps.length < 2) { console.log('PASS: 不足 2 步，跳过排序检查'); process.exit(0); }
    d.steps.forEach((s, i) => {
      if (!s.created_at) throw new Error('FAIL: steps['+i+'] 缺少 created_at');
    });
    for (let i = 1; i < d.steps.length; i++) {
      if (new Date(d.steps[i-1].created_at) > new Date(d.steps[i].created_at)) {
        throw new Error('FAIL: steps[' + (i-1) + '].created_at > steps[' + i + '].created_at');
      }
    }
    console.log('PASS: ' + d.steps.length + ' 个步骤 created_at 均存在且升序');
  "

# Triple 1.3: label 唯一性（多轮 Propose/Review 通过 R1/R2 区分）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const labels = d.steps.map(s => s.label);
    const seen = new Set();
    labels.forEach((l, i) => {
      if (seen.has(l)) throw new Error('FAIL: 重复 label \"' + l + '\" at steps['+i+']');
      seen.add(l);
    });
    console.log('PASS: ' + labels.length + ' 个 label 均唯一: ' + labels.join(', '));
  "
```

---

## Feature 2: 每步 Input/Prompt/Output 数据 — 三栏内容字段

**行为描述**:
pipeline-detail API 的每个 step 对象额外包含 `input_content`、`prompt_content`、`output_content` 三个字段（字符串或 null）。不同步骤类型的数据来源不同：Planner 的 input 是用户原始需求，output 是 sprint-prd.md；Propose 的 input 是 PRD 内容，output 是 contract-draft.md；Review 的 input 是合同草案，output 是 review-feedback.md。

**硬阈值**:
- 每个 step 包含 `input_content`、`prompt_content`、`output_content` 三个字段（可为 null 但必须存在）
- 已完成步骤（status=completed）的 `output_content` 不为 null
- Planner 步骤的 `input_content` 包含用户原始需求文字

**验证命令**:
```bash
# Triple 2.1: 三栏字段存在性
PLANNER_ID="98503cee-f277-4690-8254-fb9058b5dee3"
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tripleFields = ['input_content','prompt_content','output_content'];
    d.steps.forEach((s, i) => {
      tripleFields.forEach(f => {
        if (!(f in s)) throw new Error('FAIL: steps['+i+'] 缺少字段 '+f);
      });
    });
    console.log('PASS: 所有步骤包含三栏字段 (input_content/prompt_content/output_content)');
  "

# Triple 2.2: 已完成步骤 output_content 非空
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const completed = d.steps.filter(s => s.status === 'completed');
    if (completed.length === 0) throw new Error('FAIL: 无已完成步骤');
    completed.forEach((s, i) => {
      if (!s.output_content) throw new Error('FAIL: 已完成步骤 \"'+s.label+'\" output_content 为空');
    });
    console.log('PASS: ' + completed.length + ' 个已完成步骤 output_content 均非空');
  "

# Triple 2.3: 边界 — 不存在的 planner_task_id 返回 200 + 空 steps（HTTP 状态码显式验证）
node -e "
  const http = require('http');
  http.get('http://localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000', (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode !== 200) throw new Error('FAIL: 无效 ID 应返回 200，实际 ' + res.statusCode);
      const d = JSON.parse(body);
      if (!Array.isArray(d.steps)) throw new Error('FAIL: 无效 ID 时 steps 应为数组');
      if (d.steps.length > 0) throw new Error('FAIL: 无效 ID 返回了 ' + d.steps.length + ' 个步骤');
      console.log('PASS: 不存在的 planner_task_id 返回 200 + 空 steps 数组');
    });
  });
"
```

---

## Feature 3: 前端步骤列表 + 三栏钻取视图

**行为描述**:
HarnessPipelineDetailPage 页面主体区域渲染串行步骤列表。每个步骤显示序号、类型标签、状态图标、耗时。点击步骤展开三栏并排视图（Input | Prompt | Output），等宽字体渲染，无内容显示"暂无数据"。同时只能展开一个步骤（手风琴模式）。

**硬阈值**:
- 步骤列表从 steps 数组渲染，每项显示 label + status
- 手风琴模式：同时只有一个步骤展开
- 三栏内容用等宽字体 `<pre>` 或 monospace 样式渲染
- 无内容的栏显示"暂无数据"占位文字

**验证命令**:
```bash
# Triple 3.1: 组件包含 useState 管理展开状态（AST-level 验证，排除注释）
node -e "
  const fs = require('fs');
  const src = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  // 验证 useState 在函数体中（非注释）
  const lines = src.split('\n');
  const useStateLines = lines.filter((l, i) => {
    const trimmed = l.trim();
    return trimmed.includes('useState') && !trimmed.startsWith('//') && !trimmed.startsWith('*');
  });
  if (useStateLines.length === 0) throw new Error('FAIL: 未找到 useState 调用（排除注释行）');
  // 验证 monospace 样式存在
  if (!src.includes('monospace') && !src.includes('pre>') && !src.includes('fontFamily')) throw new Error('FAIL: 缺少 monospace/pre 样式');
  console.log('PASS: useState 调用 ' + useStateLines.length + ' 处（非注释），monospace 样式存在');
"

# Triple 3.2: "暂无数据" 占位文字存在
node -e "
  const src = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if (!src.includes('暂无数据')) throw new Error('FAIL: 缺少\"暂无数据\"占位文字');
  console.log('PASS: 包含\"暂无数据\"占位文字');
"

# Triple 3.3: 步骤列表渲染 steps 数组（map 遍历）
node -e "
  const src = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if (!src.includes('steps') || !src.includes('.map(')) throw new Error('FAIL: 未发现 steps 数组遍历');
  // 验证三栏标题
  const hasInput = src.includes('Input');
  const hasPrompt = src.includes('Prompt');
  const hasOutput = src.includes('Output');
  if (!hasInput || !hasPrompt || !hasOutput) throw new Error('FAIL: 缺少三栏标题 Input/Prompt/Output');
  console.log('PASS: steps.map 遍历存在，三栏标题 Input/Prompt/Output 齐全');
"

# Triple 3.4: 手风琴逻辑验证（点击同一步骤应关闭，点击其他步骤应切换）
node -e "
  const src = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  // 验证手风琴模式：toggle 逻辑（点击已展开的项应关闭 → null 或 -1）
  const hasToggle = /expanded.*===.*\?.*null|expanded.*===.*\?.*-1|setExpanded.*prev.*===/.test(src);
  if (!hasToggle) throw new Error('FAIL: 未发现手风琴 toggle 逻辑（点击已展开项关闭）');
  console.log('PASS: 手风琴 toggle 逻辑存在');
"
```

---

## Feature 4: Prompt 重建逻辑

**行为描述**:
pipeline-detail API 为每个步骤重建 `prompt_content`，重现 executor.js 中 preparePrompt 的逻辑。Prompt 包含 skill 名称、task_id、sprint_dir 等参数，以及嵌入的文件内容（PRD、合同草案、review 反馈等）。Prompt 中不应残留未替换的模板变量。

**硬阈值**:
- 至少 1 个步骤的 `prompt_content` 不为 null
- prompt_content 不包含未替换的已知模板变量（task_id、sprint_dir、planner_branch 等）
- prompt_content 包含实际的 skill 名称或文件内容

**验证命令**:
```bash
# Triple 4.1: prompt_content 存在且含实际内容
PLANNER_ID="98503cee-f277-4690-8254-fb9058b5dee3"
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const withPrompt = d.steps.filter(s => s.prompt_content);
    if (withPrompt.length === 0) throw new Error('FAIL: 无任何步骤有 prompt_content');
    console.log('PASS: ' + withPrompt.length + '/' + d.steps.length + ' 个步骤有 prompt_content');
  "

# Triple 4.2: prompt 无未替换的已知模板变量（大写和小写均检查）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.steps.forEach(s => {
      if (s.prompt_content) {
        const m = s.prompt_content.match(/\{[a-zA-Z_]+\}/g);
        if (m) {
          const knownVars = ['task_id','sprint_dir','planner_branch','propose_branch','review_branch','TASK_ID','SPRINT_DIR','PLANNER_BRANCH','PROPOSE_BRANCH','REVIEW_BRANCH','planner_task_id','propose_round','contract_branch'];
          const suspicious = m.filter(v => knownVars.includes(v.slice(1, -1)));
          if (suspicious.length > 0) throw new Error('FAIL: step ' + s.step + ' prompt 含未替换模板变量: ' + suspicious.join(', '));
        }
      }
    });
    console.log('PASS: 所有 prompt 无未替换的已知模板变量（大小写均检查）');
  "

# Triple 4.3: Planner 步骤 prompt 包含 skill 名称
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const planner = d.steps.find(s => s.task_type === 'harness_planner');
    if (!planner) throw new Error('FAIL: 未找到 planner 步骤');
    if (!planner.prompt_content) throw new Error('FAIL: planner 步骤无 prompt_content');
    if (!planner.prompt_content.includes('planner') && !planner.prompt_content.includes('harness')) {
      throw new Error('FAIL: planner prompt 不含 skill 名称');
    }
    console.log('PASS: planner prompt 包含 skill 名称，长度 ' + planner.prompt_content.length + ' 字符');
  "
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — steps 构建 + prompt 重建 + 三栏数据

**范围**: `packages/brain/src/routes/harness.js` 中的 `buildSteps`、`getStepInput`、`getStepOutput`、`rebuildPrompt` 函数。确保 steps 数组包含完整的 7 个必填字段（含 created_at/completed_at）+ 三栏内容字段（input_content/prompt_content/output_content）。不存在的 planner_task_id 返回 200 + 空 steps。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] pipeline-detail API 返回 steps 数组，每步包含 7 个必填字段（step/task_id/task_type/label/status/created_at/completed_at 均不为 null）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const R=['step','task_id','task_type','label','status','created_at','completed_at'];d.steps.forEach((s,i)=>{R.forEach(f=>{if(s[f]===undefined||s[f]===null)throw new Error('FAIL: steps['+i+'] missing '+f)})});console.log('PASS: '+d.steps.length+' steps, all 7 required fields present')"
- [ ] [BEHAVIOR] steps 按 created_at 升序排列，且每步 created_at 非空
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(d.steps.length<2){console.log('PASS: <2 steps');process.exit(0)}d.steps.forEach((s,i)=>{if(!s.created_at)throw new Error('FAIL: steps['+i+'] missing created_at')});for(let i=1;i<d.steps.length;i++){if(new Date(d.steps[i-1].created_at)>new Date(d.steps[i].created_at))throw new Error('FAIL: order')}console.log('PASS: '+d.steps.length+' steps in created_at ASC')"
- [ ] [BEHAVIOR] 每步包含 input_content/prompt_content/output_content 三栏字段，已完成步骤 output_content 非空
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));d.steps.forEach((s,i)=>{['input_content','prompt_content','output_content'].forEach(f=>{if(!(f in s))throw new Error('FAIL: steps['+i+'] missing '+f)});if(s.status==='completed'&&!s.output_content)throw new Error('FAIL: completed step '+s.label+' no output')});console.log('PASS: triple fields present, completed steps have output')"
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回 HTTP 200 + 空 steps 数组（显式验证 HTTP 状态码）
  Test: node -e "const http=require('http');http.get('http://localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000',(res)=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{if(res.statusCode!==200)throw new Error('FAIL: expected 200, got '+res.statusCode);const d=JSON.parse(b);if(!Array.isArray(d.steps)||d.steps.length>0)throw new Error('FAIL: expected empty steps');console.log('PASS: 200 + empty steps')})})"
- [ ] [BEHAVIOR] prompt_content 无未替换的已知模板变量（大小写均检查，扩展变量列表）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const known=['task_id','sprint_dir','planner_branch','propose_branch','review_branch','TASK_ID','SPRINT_DIR','PLANNER_BRANCH','PROPOSE_BRANCH','REVIEW_BRANCH','planner_task_id','propose_round','contract_branch'];d.steps.forEach(s=>{if(s.prompt_content){const m=s.prompt_content.match(/\{[a-zA-Z_]+\}/g);if(m){const bad=m.filter(v=>known.includes(v.slice(1,-1)));if(bad.length>0)throw new Error('FAIL: step '+s.step+' has unresolved vars: '+bad.join(','))}}});console.log('PASS: no unresolved template vars')"

### Workstream 2: Frontend — 步骤列表 + 手风琴三栏钻取视图

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`。重写主体区域为步骤列表 + 三栏展开视图。保留页面标题和阶段时间线概览横条。
**大小**: M（100-300行）
**依赖**: Workstream 1（API 必须返回 steps 数组）

**DoD**:
- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 包含步骤列表渲染和三栏展开逻辑
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 组件使用 useState 管理展开状态（非注释行），包含 monospace 样式渲染
  Test: node -e "const src=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const lines=src.split('\n').filter(l=>{const t=l.trim();return t.includes('useState')&&!t.startsWith('//')&&!t.startsWith('*')});if(lines.length===0)throw new Error('FAIL: no useState');if(!src.includes('monospace')&&!src.includes('pre>')&&!src.includes('fontFamily'))throw new Error('FAIL: no monospace');console.log('PASS: useState '+lines.length+' calls, monospace present')"
- [ ] [BEHAVIOR] 包含 "暂无数据" 占位文字和三栏标题 Input/Prompt/Output
  Test: node -e "const src=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!src.includes('暂无数据'))throw new Error('FAIL: missing placeholder');['Input','Prompt','Output'].forEach(t=>{if(!src.includes(t))throw new Error('FAIL: missing '+t)});console.log('PASS: placeholder + triple headers')"
- [ ] [BEHAVIOR] 手风琴逻辑：点击已展开步骤关闭（toggle），steps.map 遍历渲染
  Test: node -e "const src=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!src.includes('.map('))throw new Error('FAIL: no .map()');if(!/expanded.*===.*\?.*null|expanded.*===.*\?.*-1|setExpanded.*prev.*===/.test(src))throw new Error('FAIL: no toggle logic');console.log('PASS: map + accordion toggle')"
