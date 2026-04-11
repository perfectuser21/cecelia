# Contract Review Feedback (Round 1)

## Triple 分析摘要

- 总验证命令数: 13
- Triple 覆盖: 13/13 (100%)
- can_bypass = Y: 6 条 (46%)
- PRD 功能点漏测: 1 个 (prompt_content 验证)

## 必须修改项

### 1. [PRD 遗漏] prompt_content 验证完全缺失

PRD 成功标准 4 明确要求 "prompt_content 的重建逻辑与 executor.js preparePrompt 一致，包含嵌入的文件内容"。合同硬阈值也写了 "prompt_content 包含对应 skill 名称关键词"。但所有验证命令中没有任何一条检查 prompt_content。

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：所有步骤的 prompt_content 直接返回 null
function buildSteps(tasks) {
  return tasks.map(t => ({
    ...t,
    input_content: t.description || "placeholder",
    prompt_content: null,  // 从不重建 prompt
    output_content: "some output"
  }));
}
// 当前所有命令均 PASS，因为没有任何命令检查 prompt_content 非空或包含 skill 名称
```

**建议修复命令**: 新增 WS1 DoD 条目
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const completed=d.steps.filter(s=>s.status==='completed');
    const skillMap={'harness_planner':'harness-planner','harness_contract_propose':'harness-contract-proposer','harness_contract_review':'harness-contract-reviewer','harness_generate':'harness-generator','harness_report':'harness-report'};
    for(const s of completed){
      if(!s.prompt_content||typeof s.prompt_content!=='string')throw new Error('FAIL:'+s.label+' prompt_content为空');
      const expected=skillMap[s.task_type];
      if(expected&&!s.prompt_content.includes(expected))throw new Error('FAIL:'+s.label+' prompt不含skill名'+expected);
    }
    console.log('PASS:'+completed.length+'个步骤的prompt_content包含正确skill名称');
  "
```

### 2. [命令太弱] Feature 2 happy path — input/output 只检查 truthy

**原始命令**:
```bash
# WS1 DoD2 / Feature 2 happy path
...if(!s.input_content)throw new Error('FAIL')...
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：所有步骤返回固定字符串 "x"
function buildSteps(tasks) {
  return tasks.map(t => ({
    ...t,
    input_content: "x",      // truthy，通过 !s.input_content 检查
    output_content: "x",     // truthy，通过
    prompt_content: "x"      // truthy，通过
  }));
}
// 命令 PASS，但内容完全是假的
```

**建议修复命令**: 对 Planner 步骤验证 input 包含原始需求关键词，output 包含 PRD 标题
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const planner=d.steps.find(s=>s.task_type==='harness_planner'&&s.status==='completed');
    if(!planner)throw new Error('FAIL:no completed planner');
    if(planner.input_content.length<20)throw new Error('FAIL:input太短,疑似假数据('+planner.input_content.length+'chars)');
    if(planner.output_content.length<100)throw new Error('FAIL:output太短,疑似假数据('+planner.output_content.length+'chars)');
    if(!/Sprint PRD|PRD|Pipeline/.test(planner.output_content))throw new Error('FAIL:planner output不含PRD标题');
    console.log('PASS:planner input='+planner.input_content.length+'chars, output='+planner.output_content.length+'chars');
  "
```

### 3. [命令太弱] Feature 1 boundary — 只检查 HTTP 状态码

**原始命令**:
```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000")
if [ "$STATUS" = "404" ] || [ "$STATUS" = "200" ]; then
  echo "PASS: 不存在的 pipeline 返回 $STATUS"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：所有请求返回 200 + 任意 JSON
app.get('/api/brain/harness/pipeline-detail', (req, res) => {
  res.json({ message: "hello" });  // 无 steps 字段，HTTP 200 通过
});
```

**建议修复命令**:
```bash
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
```

### 4. [工具不对] Feature 3 / WS2 — 前端全部是静态检查，无运行时验证

**原始命令**:
```bash
# F3 cmd2: 只检查页面 HTTP 200
curl -sf "http://localhost:5211/harness/pipeline/..." -o /dev/null
# F3 cmd3 / WS2 DoD2: 正则匹配源码关键词
node -e "...if(!/steps/.test(c))throw..."
```

**假实现片段**（proof-of-falsification）:
```typescript
// 假实现：组件包含所有关键词但全在注释里
export default function HarnessPipelineDetailPage() {
  // steps Input Prompt Output 暂无数据
  return <div>Empty page</div>;
}
// F3 cmd3 和 WS2 DoD2 均 PASS（正则匹配到注释中的关键词）
// F3 cmd2 PASS（页面返回 200，内容为空 div）
```

**建议修复命令**: 至少验证渲染 HTML 包含关键 DOM 结构
```bash
# 方案 A：curl 检查渲染后 HTML 包含步骤容器（如果是 SPA 则用 node 检查组件导出）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  // 检查 JSX 中实际渲染了 steps（不是注释）
  const noComments=c.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/{\/\*[\s\S]*?\*\/}/g,'');
  if(!/steps\.map|steps\.length/.test(noComments))throw new Error('FAIL:steps未在JSX中被实际渲染(只在注释中)');
  if(!/Input/.test(noComments))throw new Error('FAIL:Input未在代码中渲染');
  if(!/Prompt/.test(noComments))throw new Error('FAIL:Prompt未在代码中渲染');
  if(!/Output/.test(noComments))throw new Error('FAIL:Output未在代码中渲染');
  if(!/暂无数据/.test(noComments))throw new Error('FAIL:暂无数据未在代码中渲染');
  console.log('PASS:关键元素在实际代码中渲染(已排除注释)');
"
```

### 5. [命令太弱] F3 cmd2 — 页面 curl 只检查 HTTP 200

**原始命令**:
```bash
curl -sf "http://localhost:5211/harness/pipeline/98503cee-f277-4690-8254-fb9058b5dee3" -o /dev/null && echo "PASS"
```

**假实现片段**（proof-of-falsification）:
```javascript
// SPA 框架总是返回 index.html (200)，即使路由组件完全空白
// 所有 SPA 路由都返回 200，此命令永远 PASS
```

**建议修复命令**: 检查返回的 HTML 至少包含 app 根节点和 bundle 引用
```bash
curl -sf "http://localhost:5211/harness/pipeline/98503cee-f277-4690-8254-fb9058b5dee3" | \
  node -e "
    const html=require('fs').readFileSync('/dev/stdin','utf8');
    if(!html.includes('id=\"root\"')&&!html.includes('id=\"app\"'))throw new Error('FAIL:HTML缺少app根节点');
    if(html.length<500)throw new Error('FAIL:HTML太短('+html.length+'chars),疑似空页面');
    console.log('PASS:页面HTML长度='+html.length+'chars');
  "
```

## 可选改进

- 考虑增加对 `completed_at` 字段的验证（已完成步骤应有 completed_at）
- 可增加多轮 GAN 场景的集成测试（目前只验证了单个 pipeline 的 label 格式）
- 手风琴行为（展开新步骤关闭旧步骤）目前无法通过命令验证，可标注为 manual:chrome: 手动验证
