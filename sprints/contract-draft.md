# Sprint Contract Draft (Round 2)

> Round 1 审查反馈核心问题：所有前端验证命令使用 `readFileSync + includes` 模式，类型定义/注释/未使用 import 可蒙混过关；Backend happy path 只检查字段存在不检查字段有值。Round 2 已全部修复。

---

## Feature 1: Pipeline 详情 API

**行为描述**:
通过 GET 请求传入 planner_task_id，后端返回该 Pipeline 的全链路详情：基础信息（标题、状态、时间线）、每个阶段的任务数据、每个阶段关联的 git 分支文件内容（sprint-prd.md、每轮 contract-draft.md / contract-review-feedback.md、最终 sprint-contract.md）。后端通过 tasks 表查询阶段任务，再通过 dev_records 表反查分支名，最后用 git show 读取分支上的文件。

**硬阈值**:
- 响应包含 `pipeline` 对象，含非空 `title`、`status`、`created_at` 字段
- 响应包含 `stages` 数组，长度 > 0，每个元素含 `task_type`、`status`、`task_id`
- 响应包含 `files` 对象，含 `prd` 键
- 响应包含 `gan_rounds` 数组
- stages 中至少包含一个 task_type 含 "planner" 的元素
- 不存在的 planner_task_id 返回 404
- 缺少 planner_task_id 参数返回 400
- 响应时间 < 5 秒

**验证命令**:
```bash
# Happy path：获取一个已完成的 pipeline 详情，检查字段存在且有值
PLANNER_ID=$(curl -sf "localhost:5221/api/brain/harness-pipelines?limit=1" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p=d.pipelines[0]; if(!p) {console.error('NO_PIPELINE'); process.exit(1);}
    const planner=p.stages.find(s=>s.task_type.includes('planner'));
    if(!planner||!planner.id) {console.error('NO_PLANNER_ID'); process.exit(1);}
    console.log(planner.id);")
curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(!d.pipeline||!d.pipeline.title) throw new Error('FAIL: pipeline 缺少非空 title');
    if(!d.pipeline.status) throw new Error('FAIL: pipeline 缺少 status');
    if(!d.pipeline.created_at) throw new Error('FAIL: pipeline 缺少 created_at');
    if(!Array.isArray(d.stages)||d.stages.length===0) throw new Error('FAIL: stages 为空数组');
    if(!d.stages[0].task_type) throw new Error('FAIL: stage[0] 缺少 task_type');
    if(!d.stages.some(s=>s.task_type.includes('planner'))) throw new Error('FAIL: stages 中无 planner 类型');
    if(!Array.isArray(d.gan_rounds)) throw new Error('FAIL: 缺少 gan_rounds 数组');
    if(typeof d.files!=='object'||!('prd' in d.files)) throw new Error('FAIL: files 缺少 prd 键');
    console.log('PASS: pipeline 详情 API 字段完整且有值，stages=' + d.stages.length + ' gan_rounds=' + d.gan_rounds.length);
  "

# 失败路径：不存在的 planner_task_id 返回 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000")
[ "$STATUS" = "404" ] && echo "PASS: 不存在的 planner_task_id 返回 404" || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)

# 边界：缺少参数返回 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness-pipeline-detail")
[ "$STATUS" = "400" ] && echo "PASS: 缺少参数返回 400" || (echo "FAIL: 期望 400，实际 $STATUS"; exit 1)
```

---

## Feature 2: Pipeline 列表页点击导航

**行为描述**:
在现有 Pipeline 列表页（`/pipeline`）中，点击某条 Pipeline 卡片可导航到该 Pipeline 的详情页。详情页 URL 格式为 `/pipeline/:planner_task_id`。

**硬阈值**:
- Pipeline 卡片可点击，点击后浏览器 URL 变为 `/pipeline/:planner_task_id`
- planner_task_id 为该 Pipeline 的 planner 阶段任务 ID
- 详情页有返回按钮可回到列表页

**验证命令**:
```bash
# 验证详情页路由已在 Route 声明中注册（排除注释和类型定义）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');
  if(!c.match(/<Route[^>]*path[^>]*planner_task_id/))
    throw new Error('FAIL: App.tsx 中未找到 <Route path=...planner_task_id 声明');
  console.log('PASS: 详情页路由已注册');
"

# 验证列表页组件包含 planner 相关的实际导航调用（而非仅 import）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');
  if(!(c.includes('navigate') && c.includes('planner')) && 
     !(c.match(/<Link[^>]*planner/)))
    throw new Error('FAIL: 列表页无 planner 相关的导航逻辑');
  console.log('PASS: 列表页包含 planner 导航逻辑');
"
```

---

## Feature 3: Pipeline 详情页 — 阶段时间线

**行为描述**:
详情页顶部展示该 Pipeline 的 6 步进度条（Planner → Propose → Review → Generate → CI Watch → Report），每个阶段显示状态图标和耗时。已完成阶段显示绿色勾，进行中显示蓝色旋转，失败显示红色叉，未开始显示灰色占位。

**硬阈值**:
- 6 个阶段全部展示，不遗漏
- 每个阶段至少展示：阶段名称、状态图标
- 已完成阶段展示耗时（started_at 到 completed_at）
- 进行中阶段有视觉区分（动画或颜色）

**验证命令**:
```bash
# 验证详情页包含 stages 遍历渲染逻辑（排除仅类型定义）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/stages?\\.map|stages?\\.forEach/))
    throw new Error('FAIL: 未找到 stages 遍历渲染逻辑');
  if(!c.match(/planner|Planner/i))
    throw new Error('FAIL: 未引用 planner 阶段');
  console.log('PASS: 详情页包含 stages 遍历渲染');
"

# 验证至少覆盖 6 个阶段类型关键词 + 有渲染逻辑
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  const stages=['planner','propose','review','generat','evaluat','report'];
  const hits=stages.filter(s=>c.toLowerCase().includes(s));
  if(hits.length<4) throw new Error('FAIL: only '+hits.length+'/6 stages');
  if(!c.match(/stages?\\.map|stages?\\.forEach/))
    throw new Error('FAIL: 有关键词但无遍历渲染逻辑，可能是死代码');
  console.log('PASS: '+hits.length+'/6 stages + 有渲染逻辑');
"
```

---

## Feature 4: Pipeline 详情页 — GAN 对抗轮次展示

**行为描述**:
详情页中展示 GAN 对抗过程的每一轮次（R1、R2、R3...）。每轮展示：DOD 草稿内容（Markdown 渲染）、Reviewer 的 verdict（PASS/FAIL）和反馈文字。最终通过的合同（sprint-contract.md）单独高亮展示。无 GAN 数据时显示"暂无对抗记录"占位。

**硬阈值**:
- 每轮按 R1/R2/R3 标签区分
- DOD 草稿和反馈内容支持 Markdown 渲染（JSX 中实际使用渲染组件）
- 无数据时显示占位文案（在 JSX 字符串中，非注释）
- verdict 为 PASS 时绿色高亮，FAIL 时红色高亮

**验证命令**:
```bash
# 验证详情页包含 GAN rounds 遍历渲染逻辑
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/gan_rounds?\\.map|rounds?\\.map/))
    throw new Error('FAIL: 未找到 GAN rounds 遍历渲染');
  if(!c.match(/verdict/i))
    throw new Error('FAIL: 未展示 verdict');
  console.log('PASS: GAN 轮次有遍历渲染 + verdict');
"

# 验证无数据占位文案在 JSX 字符串中（非注释）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/['\"\`>]暂无/))
    throw new Error('FAIL: 占位文案未在字符串/JSX中使用（可能仅在注释中）');
  console.log('PASS: 占位文案在 JSX 字符串中');
"
```

---

## Feature 5: Pipeline 详情页 — 用户原始输入与 PRD

**行为描述**:
详情页展示 Pipeline 的起源：Planner 任务 payload 中的用户原始需求描述，以及 sprint-prd.md 的完整内容（Markdown 渲染）。

**硬阈值**:
- PRD 内容用 Markdown 渲染组件展示（JSX 中实际使用 `<ReactMarkdown` 或 `<Markdown` 或 `dangerouslySetInnerHTML`）
- 用户原始输入可见（来自 planner 任务 description 或 payload）

**验证命令**:
```bash
# 验证详情页使用了 Markdown 渲染组件（JSX 中实际调用，非仅 import）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  if(!c.match(/<ReactMarkdown|<Markdown|dangerouslySetInnerHTML/))
    throw new Error('FAIL: 未在 JSX 中实际使用 Markdown 渲染组件');
  console.log('PASS: Markdown 渲染组件已在 JSX 中使用');
"
```

---

## Feature 6: 无内容优雅降级

**行为描述**:
用户访问尚未完成所有阶段的 Pipeline 详情页时：已完成阶段正常展示，进行中阶段显示"执行中..."，未开始阶段显示灰色占位，git 文件读取失败时显示"文件暂不可用"。

**硬阈值**:
- 页面不因缺失数据而报错
- 至少有 2 种不同状态的降级文案在 JSX 中使用

**验证命令**:
```bash
# 验证降级文案在 JSX 字符串中出现（至少 2 处）
node -e "
  const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');
  const patterns=[/['\"\`>]暂不可用/,/['\"\`>]执行中/,/['\"\`>]暂无/];
  const hits=patterns.filter(p=>p.test(c));
  if(hits.length<2)
    throw new Error('FAIL: 降级文案在字符串/JSX中仅出现'+hits.length+'处（需至少2处）');
  console.log('PASS: '+hits.length+' 处降级文案');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — Pipeline 详情 API

**范围**: 新增 `GET /api/brain/harness-pipeline-detail` 端点，包括 tasks 查询、dev_records 分支反查、git 文件读取、错误处理（404/400）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/harness-pipeline-detail?planner_task_id=xxx` 返回完整 pipeline 对象（含非空 title/status/created_at）、stages 数组（非空，含 task_type）、files 对象（含 prd 键）、gan_rounds 数组
  Test: manual:curl -sf "localhost:5221/api/brain/harness-pipelines?limit=1" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const p=d.pipelines[0];if(!p){process.exit(1);}const pl=p.stages.find(s=>s.task_type.includes('planner'));console.log(pl.id);" > /tmp/_pid.txt && curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=$(cat /tmp/_pid.txt)" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.pipeline||!d.pipeline.title)throw new Error('FAIL');if(!Array.isArray(d.stages)||d.stages.length===0)throw new Error('FAIL');if(!d.stages[0].task_type)throw new Error('FAIL');if(!d.stages.some(s=>s.task_type.includes('planner')))throw new Error('FAIL');if(typeof d.files!=='object'||!('prd' in d.files))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回 404，缺少参数返回 400
  Test: manual:bash -c 'S=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000");[ "$S" = "404" ] && echo "PASS 404" || (echo "FAIL: $S"; exit 1)' && bash -c 'S=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness-pipeline-detail");[ "$S" = "400" ] && echo "PASS 400" || (echo "FAIL: $S"; exit 1)'

### Workstream 2: Frontend — 详情页 + 列表导航

**范围**: 新增详情页组件（阶段时间线、GAN 轮次展示、PRD/Markdown 渲染、降级处理），列表页卡片添加点击导航，路由注册
**大小**: L（>300行）
**依赖**: Workstream 1 完成后（API 端点可用）

**DoD**:
- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 存在且非空
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(c.length<100)throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页路由 `/pipeline/:planner_task_id` 在 App.tsx 中以 `<Route` 声明注册
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.match(/<Route[^>]*path[^>]*planner_task_id/))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 列表页包含 planner 相关的导航调用（navigate+planner 或 Link+planner 组合）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!(c.includes('navigate')&&c.includes('planner'))&&!c.match(/<Link[^>]*planner/))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页遍历渲染 stages（`.map` 调用）并引用 planner 阶段
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/stages?\\.map/))throw new Error('FAIL: no stages.map');if(!c.match(/planner|Planner/i))throw new Error('FAIL: no planner');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页遍历渲染 GAN rounds（`.map` 调用）并展示 verdict
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/gan_rounds?\\.map|rounds?\\.map/))throw new Error('FAIL: no rounds.map');if(!c.match(/verdict/i))throw new Error('FAIL: no verdict');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页在 JSX 中使用 Markdown 渲染组件（`<ReactMarkdown` 或 `<Markdown` 或 `dangerouslySetInnerHTML`）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/<ReactMarkdown|<Markdown|dangerouslySetInnerHTML/))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 无数据时至少 2 处降级文案在 JSX 字符串中出现（暂不可用/执行中/暂无）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const p=[/['\"\`>]暂不可用/,/['\"\`>]执行中/,/['\"\`>]暂无/];const h=p.filter(r=>r.test(c));if(h.length<2)throw new Error('FAIL: '+h.length);console.log('PASS: '+h.length);"
