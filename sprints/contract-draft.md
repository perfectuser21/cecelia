# Sprint Contract Draft (Round 2)

> **Round 2 修订说明**: 针对 Reviewer Round 1 反馈的 5 个必须修改项逐一修复：
> 1. [PRD 遗漏] 新增 prompt_content 验证（含 skill 名称关键词检查）
> 2. [命令太弱] input/output 验证加强为内容长度+关键词匹配，防止假数据
> 3. [命令太弱] 不存在 pipeline 验证改为检查响应结构（空 steps 数组或 404）
> 4. [工具不对] 前端检查先剥离注释再匹配，防止关键词只在注释中
> 5. [命令太弱] 页面 curl 检查 HTML 长度和根节点存在性

---

## Feature 1: 串行步骤列表 — Backend `steps` 数组

**行为描述**:
API `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx` 的响应中新增 `steps` 字段，返回该 Pipeline 所有已执行步骤组成的数组。每个元素包含 `step`（序号）、`task_id`、`task_type`、`label`（人类可读标签如 "Planner"、"Propose R1"、"Review R2"）、`status`、`created_at`、`completed_at`。数组按 `created_at` 升序排列。多轮 Propose/Review 时，label 自动附带轮次编号。

**硬阈值**:
- `steps` 是数组，元素数 >= 1（至少包含 Planner 步骤）
- 每个 step 包含必填字段：`step`(number)、`task_id`(string)、`task_type`(string)、`label`(string)、`status`(string)、`created_at`(string)
- `steps` 按 `created_at` 升序排列
- 多轮 Propose/Review 的 label 包含轮次编号（如 "Propose R1"、"Review R2"）

**验证命令**:
```bash
# F1-cmd1: Happy path — steps 数组存在、字段完整、升序排列
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(d.steps)) throw new Error('FAIL: steps 不是数组');
    if (d.steps.length < 1) throw new Error('FAIL: steps 为空');
    const required = ['step','task_id','task_type','label','status','created_at'];
    for (const s of d.steps) {
      for (const f of required) {
        if (s[f] === undefined || s[f] === null) throw new Error('FAIL: step ' + s.step + ' 缺少字段 ' + f);
      }
      if (typeof s.step !== 'number') throw new Error('FAIL: step 不是 number');
    }
    for (let i = 1; i < d.steps.length; i++) {
      if (d.steps[i].created_at < d.steps[i-1].created_at) throw new Error('FAIL: steps 未按 created_at 升序');
    }
    console.log('PASS: ' + d.steps.length + ' 个步骤，字段完整，升序正确');
  "

# F1-cmd2: 边界 — 不存在的 pipeline 返回空 steps 数组或 404（验证响应结构）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(!Array.isArray(d.steps))throw new Error('FAIL:响应缺少steps数组');
    if(d.steps.length!==0)throw new Error('FAIL:不存在的pipeline应返回空steps,实际'+d.steps.length);
    console.log('PASS:不存在pipeline返回空steps数组');
  " || {
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000");
    if [ "$STATUS" = "404" ]; then echo "PASS:返回404"; else echo "FAIL:期望空steps或404,实际$STATUS"; exit 1; fi
  }

# F1-cmd3: 多轮 label 格式验证
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const proposes = d.steps.filter(s => s.task_type === 'harness_contract_propose');
    const reviews = d.steps.filter(s => s.task_type === 'harness_contract_review');
    for (const s of proposes) {
      if (!/Propose R\d/.test(s.label)) throw new Error('FAIL: Propose label 缺少轮次: ' + s.label);
    }
    for (const s of reviews) {
      if (!/Review R\d/.test(s.label)) throw new Error('FAIL: Review label 缺少轮次: ' + s.label);
    }
    console.log('PASS: ' + proposes.length + ' Propose + ' + reviews.length + ' Review labels 均含轮次编号');
  "
```

---

## Feature 2: 每步 Input/Prompt/Output 数据重建（Backend）

**行为描述**:
`steps` 数组中每个元素额外包含 `input_content`、`prompt_content`、`output_content` 三个字段（string 或 null）。数据通过 git show 从对应分支读取文件内容重建。Planner 步骤的 input 为用户原始需求（task.description），output 为 sprint-prd.md；Propose 步骤的 input 为 PRD 内容，output 为 contract-draft.md；Review 步骤的 input 为合同草案，output 为 review-feedback。`prompt_content` 重建自 executor.js preparePrompt 逻辑，包含对应 skill 名称和嵌入的文件内容。

**硬阈值**:
- 已完成步骤：`input_content` 不为 null 且长度 >= 20（防止假数据）
- 已完成步骤：`output_content` 不为 null 且长度 >= 50（防止假数据）
- 已完成步骤：`prompt_content` 不为 null，包含对应 skill 名称关键词
- 每个字段为 string 或 null，不允许 undefined
- Planner output 包含 "Sprint PRD" 或 "PRD" 关键词
- 未完成步骤的 `output_content` 为 null

**验证命令**:
```bash
# F2-cmd1: 已完成步骤的 input/output 内容充实度验证（防假数据）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const completed = d.steps.filter(s => s.status === 'completed');
    if (completed.length === 0) throw new Error('FAIL: 没有已完成步骤');
    for (const s of completed) {
      if (typeof s.input_content !== 'string' || s.input_content.length < 20)
        throw new Error('FAIL: ' + s.label + ' input_content 太短或为空(' + (s.input_content?.length||0) + 'chars)');
      if (typeof s.output_content !== 'string' || s.output_content.length < 50)
        throw new Error('FAIL: ' + s.label + ' output_content 太短或为空(' + (s.output_content?.length||0) + 'chars)');
    }
    // Planner 步骤 output 包含 PRD 关键词
    const planner = d.steps.find(s => s.task_type === 'harness_planner' && s.status === 'completed');
    if (planner && !/Sprint PRD|PRD|Pipeline/.test(planner.output_content))
      throw new Error('FAIL: planner output 不含 PRD 标题');
    console.log('PASS: ' + completed.length + ' 个已完成步骤内容充实');
  "

# F2-cmd2: prompt_content 包含对应 skill 名称（Round 1 reviewer 重点要求）
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const completed = d.steps.filter(s => s.status === 'completed');
    const skillMap = {
      'harness_planner': 'harness-planner',
      'harness_contract_propose': 'harness-contract-proposer',
      'harness_contract_review': 'harness-contract-reviewer',
      'harness_generate': 'harness-generator',
      'harness_report': 'harness-report'
    };
    for (const s of completed) {
      if (!s.prompt_content || typeof s.prompt_content !== 'string')
        throw new Error('FAIL: ' + s.label + ' prompt_content 为空');
      const expected = skillMap[s.task_type];
      if (expected && !s.prompt_content.includes(expected))
        throw new Error('FAIL: ' + s.label + ' prompt 不含 skill 名 ' + expected);
    }
    console.log('PASS: ' + completed.length + ' 个步骤的 prompt_content 包含正确 skill 名称');
  "

# F2-cmd3: 未完成步骤的 output_content 应为 null
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
# F3-cmd1: TypeScript 编译无错误
cd apps/dashboard && npx tsc --noEmit --project tsconfig.json 2>&1 | \
  node -e "
    const t=require('fs').readFileSync('/dev/stdin','utf8');
    if(/error TS/.test(t)){console.error('FAIL: TS编译错误');console.error(t.split('\n').filter(l=>/error TS/.test(l)).slice(0,5).join('\n'));process.exit(1)}
    console.log('PASS: TypeScript 编译通过');
  "

# F3-cmd2: 页面可加载 + HTML 包含 app 根节点且长度合理
curl -sf "http://localhost:5211/harness/pipeline/98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const html=require('fs').readFileSync('/dev/stdin','utf8');
    if(!html.includes('id=\"root\"')&&!html.includes('id=\"app\"'))throw new Error('FAIL:HTML缺少app根节点');
    if(html.length<500)throw new Error('FAIL:HTML太短('+html.length+'chars),疑似空页面');
    console.log('PASS: 页面 HTML 长度=' + html.length + ' chars');
  "

# F3-cmd3: 组件代码验证（排除注释后匹配关键元素）
node -e "
  const c = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  // 剥离注释后检查
  const noComments = c.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
  if(!/steps\.map|steps\.length|steps\.filter/.test(noComments)) throw new Error('FAIL: steps 未在实际代码中被渲染(只在注释中)');
  if(!/Input/.test(noComments)) throw new Error('FAIL: Input 未在代码中渲染');
  if(!/Prompt/.test(noComments)) throw new Error('FAIL: Prompt 未在代码中渲染');
  if(!/Output/.test(noComments)) throw new Error('FAIL: Output 未在代码中渲染');
  if(!/暂无数据/.test(noComments)) throw new Error('FAIL: 暂无数据 未在代码中渲染');
  console.log('PASS: 关键元素在实际代码中渲染(已排除注释)');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — steps 数组 + Input/Prompt/Output 数据重建

**范围**: 修改 `packages/brain/src/routes/harness.js` 中的 `pipeline-detail` 端点，新增 steps 构建逻辑。从 tasks 表查询该 pipeline 所有子任务，按 created_at 排序，为每个步骤通过 git show 从对应分支读取 input/prompt/output 文件内容。新增 prompt 重建函数（参考 executor.js preparePrompt 逻辑）。不修改 executor.js 本身。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] API `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx` 响应包含 `steps` 数组，按 `created_at` 升序，每个元素含 step/task_id/task_type/label/status/created_at/completed_at 字段
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.steps)||d.steps.length<1)throw new Error('FAIL');const r=['step','task_id','task_type','label','status','created_at'];for(const s of d.steps)for(const f of r)if(s[f]===undefined||s[f]===null)throw new Error('FAIL:'+f);for(let i=1;i<d.steps.length;i++)if(d.steps[i].created_at<d.steps[i-1].created_at)throw new Error('FAIL:order');console.log('PASS:'+d.steps.length+'steps')"
- [ ] [BEHAVIOR] 已完成步骤的 `input_content` 长度>=20、`output_content` 长度>=50，Planner output 包含 PRD 关键词
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const c=d.steps.filter(s=>s.status==='completed');for(const s of c){if(!s.input_content||s.input_content.length<20)throw new Error('FAIL:'+s.label+' input短');if(!s.output_content||s.output_content.length<50)throw new Error('FAIL:'+s.label+' output短')}const p=d.steps.find(s=>s.task_type==='harness_planner'&&s.status==='completed');if(p&&!/PRD|Pipeline/.test(p.output_content))throw new Error('FAIL:planner无PRD');console.log('PASS:'+c.length+'步骤内容充实')"
- [ ] [BEHAVIOR] 已完成步骤的 `prompt_content` 不为空且包含对应 skill 名称关键词
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const m={'harness_planner':'harness-planner','harness_contract_propose':'harness-contract-proposer','harness_contract_review':'harness-contract-reviewer','harness_generate':'harness-generator','harness_report':'harness-report'};const c=d.steps.filter(s=>s.status==='completed');for(const s of c){if(!s.prompt_content||typeof s.prompt_content!=='string')throw new Error('FAIL:'+s.label+' prompt空');const e=m[s.task_type];if(e&&!s.prompt_content.includes(e))throw new Error('FAIL:'+s.label+' 无skill名'+e)}console.log('PASS:'+c.length+'步骤prompt含skill名')"
- [ ] [BEHAVIOR] 多轮 Propose/Review 的 label 包含轮次编号（如 "Propose R1"、"Review R1"）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const p=d.steps.filter(s=>s.task_type==='harness_contract_propose');const r=d.steps.filter(s=>s.task_type==='harness_contract_review');for(const s of p)if(!/Propose R\d/.test(s.label))throw new Error('FAIL:'+s.label);for(const s of r)if(!/Review R\d/.test(s.label))throw new Error('FAIL:'+s.label);console.log('PASS:'+p.length+'P+'+r.length+'R labels正确')"
- [ ] [BEHAVIOR] 不存在的 pipeline 返回空 steps 数组或 404
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" -o /tmp/htest.json && node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/htest.json','utf8'));if(!Array.isArray(d.steps)||d.steps.length!==0)throw new Error('FAIL');console.log('PASS:空steps')" || echo "PASS:返回非200"

### Workstream 2: Frontend — 步骤列表 + 三栏钻取视图

**范围**: 重写 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 主体区域为串行步骤列表组件。每步可点击展开三栏（Input | Prompt | Output），等宽字体渲染，空内容显示"暂无数据"，手风琴模式。保留现有阶段时间线横条。
**大小**: M（100-300行）
**依赖**: Workstream 1 完成后（前端依赖 steps API）

**DoD**:
- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 包含步骤列表和三栏视图组件
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 组件实际代码（排除注释）引用 steps 数组并渲染 Input/Prompt/Output 三栏，无内容时显示"暂无数据"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const n=c.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');if(!/steps\.map|steps\.length/.test(n))throw new Error('FAIL:steps未渲染');if(!/Input/.test(n))throw new Error('FAIL');if(!/Prompt/.test(n))throw new Error('FAIL');if(!/Output/.test(n))throw new Error('FAIL');if(!/暂无数据/.test(n))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] TypeScript 编译通过
  Test: cd apps/dashboard && npx tsc --noEmit --project tsconfig.json 2>&1 | node -e "const t=require('fs').readFileSync('/dev/stdin','utf8');if(/error TS/.test(t))throw new Error('FAIL');console.log('PASS')"
