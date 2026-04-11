# Sprint Contract Draft (Round 1)

## Feature 1: 串行步骤列表 — Backend `steps` 数组

**行为描述**:
API `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx` 的响应中新增 `steps` 字段，返回该 Pipeline 所有已执行步骤组成的数组。每个元素包含 `step`（序号）、`task_id`、`task_type`、`label`（人类可读标签如 "Planner"、"Propose R1"、"Review R2"）、`status`、`created_at`、`completed_at`。数组按 `created_at` 升序排列。多轮 Propose/Review 时，label 自动附带轮次编号。

**硬阈值**:
- `steps` 是数组，元素数 >= 1（至少包含 Planner 步骤）
- 每个 step 包含以下必填字段：`step`(number)、`task_id`(string)、`task_type`(string)、`label`(string)、`status`(string)、`created_at`(string)
- `steps` 按 `created_at` 升序排列
- 多轮 Propose/Review 的 label 包含轮次编号（如 "Propose R1"、"Review R2"）

**验证命令**:
```bash
# Happy path: steps 数组存在且格式正确
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(d.steps)) throw new Error('FAIL: steps 不是数组');
    if (d.steps.length < 1) throw new Error('FAIL: steps 为空');
    const required = ['step','task_id','task_type','label','status','created_at'];
    for (const s of d.steps) {
      for (const f of required) {
        if (s[f] === undefined) throw new Error('FAIL: step ' + s.step + ' 缺少字段 ' + f);
      }
    }
    // 验证升序
    for (let i = 1; i < d.steps.length; i++) {
      if (d.steps[i].created_at < d.steps[i-1].created_at) throw new Error('FAIL: steps 未按 created_at 升序');
    }
    console.log('PASS: ' + d.steps.length + ' 个步骤，字段完整，升序正确');
  "

# 边界: planner_task_id 不存在时返回空 steps 或 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000")
if [ "$STATUS" = "404" ] || [ "$STATUS" = "200" ]; then
  echo "PASS: 不存在的 pipeline 返回 $STATUS"
else
  echo "FAIL: 期望 404 或 200，实际 $STATUS"; exit 1
fi
```

---

## Feature 2: 每步 Input/Prompt/Output 数据重建（Backend）

**行为描述**:
`steps` 数组中每个元素额外包含 `input_content`、`prompt_content`、`output_content` 三个字符串字段（或 null）。数据通过 git show 从对应分支读取文件内容重建。Planner 步骤的 input 为用户原始需求（task.description），output 为 sprint-prd.md；Propose 步骤的 input 为 PRD 内容，output 为 contract-draft.md；Review 步骤的 input 为合同草案，output 为 review-feedback；Generate 步骤的 input 为最终合同，output 为 PR URL。

**硬阈值**:
- 已完成的 Planner 步骤：`input_content` 不为 null，`output_content` 不为 null
- 已完成的 Propose 步骤：`input_content` 不为 null，`output_content` 不为 null
- 每个字段为 string 或 null，不允许 undefined
- `prompt_content` 包含对应 skill 名称关键词（如 "harness-planner"、"harness-contract-proposer"）

**验证命令**:
```bash
# Happy path: 已完成步骤的 input/output 不为 null
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const completed = d.steps.filter(s => s.status === 'completed');
    if (completed.length === 0) throw new Error('FAIL: 没有已完成步骤');
    for (const s of completed) {
      if (s.input_content === undefined) throw new Error('FAIL: step ' + s.label + ' input_content 为 undefined');
      if (s.output_content === undefined) throw new Error('FAIL: step ' + s.label + ' output_content 为 undefined');
      if (typeof s.input_content !== 'string' && s.input_content !== null) throw new Error('FAIL: input_content 类型错误');
      if (typeof s.output_content !== 'string' && s.output_content !== null) throw new Error('FAIL: output_content 类型错误');
      if (typeof s.prompt_content !== 'string' && s.prompt_content !== null) throw new Error('FAIL: prompt_content 类型错误');
    }
    // Planner 步骤特别验证
    const planner = d.steps.find(s => s.task_type === 'harness_planner' && s.status === 'completed');
    if (planner && !planner.input_content) throw new Error('FAIL: Planner input_content 为空');
    if (planner && !planner.output_content) throw new Error('FAIL: Planner output_content 为空');
    console.log('PASS: ' + completed.length + ' 个已完成步骤的三栏内容格式正确');
  "

# 边界: 未完成步骤的 output_content 应为 null
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const pending = d.steps.filter(s => s.status !== 'completed');
    for (const s of pending) {
      if (s.output_content !== null) throw new Error('FAIL: 未完成步骤 ' + s.label + ' 不应有 output_content');
    }
    console.log('PASS: ' + pending.length + ' 个未完成步骤的 output_content 均为 null');
  "
```

---

## Feature 3: 前端串行步骤列表 + 三栏钻取视图

**行为描述**:
HarnessPipelineDetailPage 主体区域显示步骤列表，每行展示序号、类型标签、状态图标、耗时。点击任一步骤行展开三栏区域（Input | Prompt | Output），栏内用等宽字体渲染，无内容显示"暂无数据"。同时只能展开一个步骤（手风琴模式）。现有阶段时间线横条保留。

**硬阈值**:
- 步骤列表渲染数量与 API `steps.length` 一致
- 点击步骤展开三栏，三栏标题分别为 "Input"、"Prompt"、"Output"
- 无内容的栏显示"暂无数据"
- 手风琴模式：展开新步骤时前一个自动关闭
- 阶段时间线横条仍然存在

**验证命令**:
```bash
# 构建检查：TypeScript 编译无错误
cd apps/dashboard && npx tsc --noEmit --project tsconfig.json 2>&1 | tail -5

# 运行时验证：页面可加载
curl -sf "http://localhost:5211/harness/pipeline/98503cee-f277-4690-8254-fb9058b5dee3" -o /dev/null && \
  echo "PASS: 页面返回 200" || echo "FAIL: 页面加载失败"

# 组件存在性验证
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx', 'utf8');
  const checks = [
    [/steps/i, 'steps 数据引用'],
    [/input_content|Input/i, 'Input 栏'],
    [/prompt_content|Prompt/i, 'Prompt 栏'],
    [/output_content|Output/i, 'Output 栏'],
    [/暂无数据/i, '空内容占位'],
  ];
  let pass = 0;
  for (const [re, name] of checks) {
    if (re.test(content)) { pass++; }
    else { console.error('FAIL: 缺少 ' + name); process.exit(1); }
  }
  console.log('PASS: 组件包含全部 ' + pass + ' 个关键元素');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — steps 数组 + Input/Prompt/Output 数据重建

**范围**: 修改 `packages/brain/src/routes/harness.js` 中的 `pipeline-detail` 端点，新增 steps 构建逻辑。从 tasks 表查询该 pipeline 所有子任务，按 created_at 排序，为每个步骤通过 git show 从对应分支读取 input/prompt/output 文件内容。新增 prompt 重建函数（参考 executor.js preparePrompt 逻辑）。不修改 executor.js。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] API `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx` 响应包含 `steps` 数组，按 `created_at` 升序，每个元素含 step/task_id/task_type/label/status/created_at/completed_at 字段
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.steps)||d.steps.length<1)throw new Error('FAIL');const r=['step','task_id','task_type','label','status','created_at'];for(const s of d.steps)for(const f of r)if(s[f]===undefined)throw new Error('FAIL:'+f);console.log('PASS:'+d.steps.length+'steps')"
- [ ] [BEHAVIOR] 已完成步骤的 `input_content` 和 `output_content` 不为 null，未完成步骤的 `output_content` 为 null
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const c=d.steps.filter(s=>s.status==='completed');if(c.length===0)throw new Error('FAIL');for(const s of c){if(!s.input_content)throw new Error('FAIL:'+s.label+' no input');if(!s.output_content)throw new Error('FAIL:'+s.label+' no output')}console.log('PASS:'+c.length+' completed steps have content')"
- [ ] [BEHAVIOR] 多轮 Propose/Review 的 label 包含轮次编号（如 "Propose R1"、"Review R1"）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const p=d.steps.filter(s=>s.task_type==='harness_contract_propose');if(p.length>0&&!/R\d/.test(p[0].label))throw new Error('FAIL: Propose label 缺少轮次');console.log('PASS: label格式正确')"

### Workstream 2: Frontend — 步骤列表 + 三栏钻取视图

**范围**: 重写 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`，将主体区域替换为串行步骤列表组件。每步可点击展开三栏（Input | Prompt | Output），等宽字体渲染，空内容显示"暂无数据"，手风琴模式。保留现有阶段时间线横条。
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后（前端依赖 steps API）

**DoD**:
- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 包含步骤列表和三栏视图组件
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 组件代码引用 steps 数组并渲染 Input/Prompt/Output 三栏，无内容时显示"暂无数据"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!/steps/.test(c))throw new Error('FAIL:no steps');if(!/Input/.test(c))throw new Error('FAIL:no Input');if(!/Prompt/.test(c))throw new Error('FAIL:no Prompt');if(!/Output/.test(c))throw new Error('FAIL:no Output');if(!/暂无数据/.test(c))throw new Error('FAIL:no placeholder');console.log('PASS')"
- [ ] [BEHAVIOR] TypeScript 编译通过
  Test: cd apps/dashboard && npx tsc --noEmit --project tsconfig.json 2>&1 | node -e "const t=require('fs').readFileSync('/dev/stdin','utf8');if(/error TS/.test(t))throw new Error('FAIL:TS errors');console.log('PASS')"
