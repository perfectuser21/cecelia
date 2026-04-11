# Contract Review Feedback (Round 1)

## 审查摘要

**覆盖率**: 13/13 命令已分析（100%）
**can_bypass 比例**: 9/13（69%）— 系统性弱验证
**核心问题**: 所有前端验证命令使用 `readFileSync + includes` 模式，类型定义/注释/未使用 import 可蒙混过关。Backend happy path 只检查字段存在不检查字段有值。

## 必须修改项

### 1. [命令太弱] Feature 1 — Happy path API 只检查字段存在，空结构体通过

**原始命令**:
```bash
curl ... | node -e "if(!d.pipeline||!d.stages||!d.gan_rounds||!d.files) throw ..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：返回空结构体，所有字段存在但无实际数据
app.get('/api/brain/harness-pipeline-detail', (req, res) => res.json({
  pipeline: { title: '', status: '', created_at: '' },
  stages: [],
  gan_rounds: [],
  files: {}
}));
// 命令通过：pipeline/stages/gan_rounds/files 全部非 falsy
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(!d.pipeline||!d.pipeline.title) throw new Error('FAIL: pipeline 缺少 title');
    if(!Array.isArray(d.stages)||d.stages.length===0) throw new Error('FAIL: stages 为空');
    if(d.stages[0]&&!d.stages[0].task_type) throw new Error('FAIL: stage 缺少 task_type');
    if(!Array.isArray(d.gan_rounds)) throw new Error('FAIL: 缺少 gan_rounds');
    if(typeof d.files!=='object'||!('prd' in d.files)) throw new Error('FAIL: files 缺少 prd 键');
    console.log('PASS: stages=' + d.stages.length + ' gan_rounds=' + d.gan_rounds.length);
  "
```

### 2. [命令太弱] Feature 2 — 路由注册检查只检查关键词，注释可蒙混

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8'); if(!c.includes(':planner_task_id')&&!c.includes('PipelineDetail')) throw ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
// 注释含关键词但未注册路由
// TODO: PipelineDetail route for :planner_task_id
export const executionRoutes = []; // 空路由数组
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');
  if(!c.match(/Route.*path.*planner_task_id|path:.*planner_task_id|<Route.*planner_task_id/))
    throw new Error('FAIL: 未找到注册 :planner_task_id 的 Route 声明');
  console.log('PASS');
"
```

### 3. [命令太弱] Feature 2 — 导航逻辑检查太松，未使用 import 可绕过

**原始命令**:
```bash
node -e "... if(c.includes('navigate')||c.includes('Link')){console.log('PASS')} ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
import { Link } from 'react-router-dom'; // 导入但未使用
// 列表页无任何点击导航逻辑
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelinePage.tsx','utf8');
  if(!(c.includes('navigate') && c.includes('planner')) && 
     !(c.includes('Link') && c.includes('planner')))
    throw new Error('FAIL: 列表页无 planner 相关的导航逻辑');
  console.log('PASS');
"
```

### 4. [命令太弱] Feature 3 — 阶段时间线检查只看关键词，类型定义可绕过

**原始命令**:
```bash
node -e "... if((c.includes('planner')||c.includes('Planner')) && (c.includes('stage')||c.includes('Stage')) && (c.includes('completed')||c.includes('in_progress'))) ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
// 仅类型定义，无渲染逻辑
type Stage = 'planner' | 'propose';
interface StageInfo { stage: string; completed: boolean; in_progress: boolean; }
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/stages?\\.map|stages?\\.forEach/))
    throw new Error('FAIL: 未找到 stages 遍历渲染逻辑');
  if(!c.match(/planner|Planner/i))
    throw new Error('FAIL: 未引用 planner 阶段');
  console.log('PASS');
"
```

### 5. [命令太弱] Feature 3 — 6阶段覆盖检查只看字符串包含

**原始命令**:
```bash
node -e "const stages=['planner','propose','review','generat','evaluat','report'].filter(s=>c.toLowerCase().includes(s)); if(hits.length<4) throw ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
type StageType = 'planner' | 'propose' | 'review' | 'generate' | 'evaluate' | 'report';
// 仅类型定义，文件中包含所有6个关键词但无任何渲染
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8');
  const stages=['planner','propose','review','generat','evaluat','report'];
  const hits=stages.filter(s=>c.toLowerCase().includes(s));
  if(hits.length<4) throw new Error('FAIL: only '+hits.length+'/6 stages');
  if(!c.match(/stages?\\.map|stages?\\.forEach/))
    throw new Error('FAIL: 有关键词但无遍历渲染逻辑，可能是死代码');
  console.log('PASS: '+hits.length+'/6 stages + 有渲染逻辑');
"
```

### 6. [命令太弱] Feature 4 — GAN 轮次检查只看关键词

**原始命令**:
```bash
node -e "if(!c.includes('round')&&!c.includes('Round')) throw ...; if(!c.includes('verdict')&&!c.includes('Verdict')) throw ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
interface GanRound { round: number; verdict: string; draft: string; feedback: string; }
// 接口定义含所有关键词，但 JSX 中未渲染
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/gan_rounds?\\.map|rounds?\\.map/))
    throw new Error('FAIL: 未找到 GAN rounds 遍历渲染');
  if(!c.match(/verdict/i))
    throw new Error('FAIL: 未展示 verdict');
  console.log('PASS');
"
```

### 7. [命令太弱] Feature 4 — 空数据降级检查可被注释绕过

**原始命令**:
```bash
node -e "if(!c.includes('暂无')&&!c.includes('暂不可用')) throw ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
// TODO: 暂无对抗记录时应显示占位文案
// 暂不可用的情况也要处理
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/['\"\`>]暂无|['\"\`>]暂不可用/))
    throw new Error('FAIL: 占位文案未在字符串/JSX中使用（可能仅在注释中）');
  console.log('PASS');
"
```

### 8. [命令太弱] Feature 5 — Markdown 渲染检查，未使用 import 可绕过

**原始命令**:
```bash
node -e "if(!c.match(/markdown|Markdown|ReactMarkdown|marked|remark|dangerouslySetInnerHTML/i)) throw ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
import ReactMarkdown from 'react-markdown'; // 导入但未使用
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/<ReactMarkdown|<Markdown|dangerouslySetInnerHTML/))
    throw new Error('FAIL: 未在 JSX 中实际使用 Markdown 渲染组件');
  console.log('PASS');
"
```

### 9. [命令太弱] Feature 6 — 降级文案检查同 Feature 4/7

**原始命令**:
```bash
node -e "const degradeHits=['暂不可用','执行中','not_started','暂无'].filter(s=>c.includes(s)); if(degradeHits.length<2) throw ..."
```

**假实现片段**（proof-of-falsification）:
```typescript
// 暂不可用 执行中 not_started 暂无 — 注释含4个关键词
const placeholder = ''; // 实际无降级逻辑
```

**建议修复命令**:
```bash
node -e "
  const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8');
  const patterns=[/['\"\`>]暂不可用/,/['\"\`>]执行中/,/['\"\`>]暂无/];
  const hits=patterns.filter(p=>p.test(c));
  if(hits.length<2)
    throw new Error('FAIL: 降级文案在字符串/JSX中仅出现'+hits.length+'处（需至少2处）');
  console.log('PASS: '+hits.length+' 处降级文案');
"
```

## 可选改进

- Feature 1 happy path 可增加 `d.stages.some(s => s.task_type.includes('planner'))` 检查 stages 中包含 planner 类型
- 考虑增加一个 API 响应时间检查（PRD 提到 < 5 秒阈值，合同未验证）
- Workstream 2 DoD 的 ARTIFACT 测试（`accessSync`）可加内容长度检查确保非空文件
- Feature 2 的列表页路径：PRD 提到 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`，但合同验证命令的 candidates 也包含了 `apps/api/` 路径，建议在 Workstream DoD 中明确是哪个目录
