# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令太弱] Workstream 1 DoD-2 — 未知 task_type 测试是纯内存逻辑，未调用实际 API

**原始命令**:
```bash
node -e "const m={'harness_planner':'harness-planner'};const r=m['unknown_type']||null;if(r!==null)throw new Error('FAIL');console.log('PASS: 未知类型返回 null')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：buildSteps 对未知 task_type 直接抛错
function buildSteps(rows) {
  rows.forEach(r => {
    const skill = TASK_TYPE_MAP[r.task_type];
    if (!skill) throw new Error('Unknown task_type: ' + r.task_type);
    // system_prompt_content 永远不会是 null，而是抛异常
  });
}
// 但上面的测试命令仍然 PASS — 因为它只测了一个 JS 字面量对象取值，根本没调用 API
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  d.steps.forEach(s => {
    if (typeof s.system_prompt_content !== 'string' && s.system_prompt_content !== null)
      throw new Error('FAIL: system_prompt_content 类型不是 string|null，实际=' + typeof s.system_prompt_content);
  });
  console.log('PASS: 所有 step 的 system_prompt_content 类型正确（string|null）');
"
```

---

### 2. [命令太弱] Feature 2 — 卡片 onClick + /step/ 检查可被注释蒙混

**原始命令**:
```bash
node -e "
  const code = fs.readFileSync('...HarnessPipelineDetailPage.tsx', 'utf8');
  const hasClickHandler = code.includes('onClick') && code.includes('/step/');
  ...
"
```

**假实现片段**（proof-of-falsification）:
```tsx
// 假实现：注释中包含关键词，实际无点击行为
export default function HarnessPipelineDetailPage() {
  // TODO: onClick navigate to /step/ with cursor-pointer
  return <div>No cards here</div>;
}
// includes('onClick') → true, includes('/step/') → true, includes('cursor-pointer') → true
// 命令 PASS，但页面没有任何卡片
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if(!(/onClick\s*=\s*\{/.test(c) && /\/step\//.test(c)))throw new Error('FAIL: onClick 未绑定到 /step/ 导航');
  if(!c.includes('cursor-pointer'))throw new Error('FAIL: 缺少 cursor-pointer');
  if(!/label|step\.label/.test(c))throw new Error('FAIL: 卡片未展示 label');
  if(!/duration|elapsed|耗时/.test(c))throw new Error('FAIL: 卡片未展示耗时');
  if(!/verdict/.test(c))throw new Error('FAIL: 卡片未展示 verdict');
  console.log('PASS: 卡片布局包含点击导航、交互样式和四项信息');
"
```

---

### 3. [PRD 遗漏] Feature 2 — 硬阈值要求四项信息（label/status/verdict/duration），但无验证命令

**原始命令**: 无（缺失）

**假实现片段**（proof-of-falsification）:
```tsx
// 假实现：卡片只有 onClick，不展示任何信息
{steps.map(s => (
  <div onClick={() => navigate(`/step/${s.step}`)} className="cursor-pointer">
    空卡片
  </div>
))}
// 所有现有命令 PASS，但卡片没有 label/status/verdict/duration
```

**建议修复命令**: 已合并到 Issue 2 的修复命令中（检查 label/duration/verdict 关键词）。

---

### 4. [命令太弱] Feature 3 路由注册 — `includes(':step')` 可被注释蒙混

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');if(!c.includes(':step'))throw new Error('FAIL');console.log('PASS')"
```

**假实现片段**（proof-of-falsification）:
```typescript
// 假实现：注释中写 :step
// TODO: add route for :step detail page
// 实际路由表无新增
export const routes = [
  { path: '/harness-pipeline', component: 'HarnessPipelinePage' },
  { path: '/harness-pipeline/:id', component: 'HarnessPipelineDetailPage' },
];
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');
  if(!/path:\s*['\"].*:step/.test(c))throw new Error('FAIL: 缺少 path 配置中的 :step 参数');
  if(!/[Ss]tep[Pp]age/.test(c))throw new Error('FAIL: 缺少 StepPage 组件引用');
  console.log('PASS: 路由已注册且引用了 StepPage 组件');
"
```

---

### 5. [命令太弱] Feature 3 返回按钮 — `includes('navigate')` 可被 import 声明蒙混

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('...HarnessPipelineStepPage.tsx','utf8');if(!/navigate/.test(c))throw new Error('FAIL');console.log('PASS')"
```

**假实现片段**（proof-of-falsification）:
```tsx
import { useNavigate } from 'react-router-dom';
export default function HarnessPipelineStepPage() {
  const navigate = useNavigate(); // 声明但未使用
  return <div>No back button</div>;
}
// /navigate/.test(code) → true，但页面无返回按钮
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');
  if(!/onClick\s*=\s*\{.*navigate/.test(c) && !/onClick\s*=\s*\{\s*\(\)\s*=>\s*navigate/.test(c))throw new Error('FAIL: 无 onClick 绑定 navigate 的返回按钮');
  if(!/harness-pipeline/.test(c))throw new Error('FAIL: navigate 未指向 harness-pipeline 路径');
  console.log('PASS: 返回按钮绑定了 navigate 且指向正确路径');
"
```

---

### 6. [缺失边界] Feature 1 — 缺少 SKILL.md 不存在时返回 null 的边界测试

**原始命令**: 无（缺失）

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：SKILL.md 不存在时抛异常导致整个 API 500
const content = fs.readFileSync(skillPath, 'utf8'); // 无 try-catch
// Happy path 测试 PASS（因为测试用的 planner_task_id 的 step 恰好都有 SKILL.md）
// 但遇到无 SKILL.md 的 task_type 时 API 崩溃
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const nullSteps = d.steps.filter(s => s.system_prompt_content === null);
  const contentSteps = d.steps.filter(s => typeof s.system_prompt_content === 'string' && s.system_prompt_content.length > 100);
  if (nullSteps.length === 0 && contentSteps.length === d.steps.length) console.log('WARN: 所有 step 都有内容，无法验证 null 边界');
  else console.log('PASS: ' + contentSteps.length + ' 个有内容，' + nullSteps.length + ' 个为 null');
  d.steps.forEach((s,i) => {
    if (s.system_prompt_content !== null && typeof s.system_prompt_content !== 'string')
      throw new Error('FAIL: step ' + i + ' system_prompt_content 类型错误');
  });
"
```

---

### 7. [命令太弱] Feature 3 子页面 — 只检查标题文字，不检查数据字段引用

**原始命令**:
```bash
node -e "...检查 /User\s*Input/i + /System\s*Prompt/i + /Output/i..."
```

**假实现片段**（proof-of-falsification）:
```tsx
export default function HarnessPipelineStepPage() {
  return (
    <div>
      <h2>User Input</h2><pre className="font-mono">暂无数据</pre>
      <h2>System Prompt</h2><pre className="font-mono">暂无数据</pre>
      <h2>Output</h2><pre className="font-mono">暂无数据</pre>
    </div>
  );
}
// 三个标题 + font-mono + 暂无数据 全部存在
// 但页面永远显示"暂无数据"，不读取实际数据
```

**建议修复命令**:
```bash
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
```

## 可选改进

- Feature 2 验证命令可增加对 `status` icon 的检查（如检查 `status` 关键词出现在渲染逻辑中）
- 考虑增加 TypeScript 编译检查（`npx tsc --noEmit`），确保新组件无类型错误
