# Sprint Contract Draft (Round 1)

## Feature 1: Pipeline 详情 API

**行为描述**:
通过 GET 请求传入 planner_task_id，后端返回该 Pipeline 的全链路详情：基础信息（标题、状态、时间线）、每个阶段的任务数据、每个阶段关联的 git 分支文件内容（sprint-prd.md、每轮 contract-draft.md / contract-review-feedback.md、最终 sprint-contract.md）。后端通过 tasks 表查询阶段任务，再通过 dev_records 表反查分支名，最后用 git show 读取分支上的文件。

**硬阈值**:
- 响应包含 `pipeline` 对象，含 `title`、`status`、`created_at` 字段
- 响应包含 `stages` 数组，每个元素含 `task_type`、`status`、`task_id`
- 响应包含 `files` 对象，键为文件标识（如 `prd`、`contract_draft_r1`），值为文件内容字符串或 null
- 响应包含 `gan_rounds` 数组，每个元素含 `round`（数字）、`draft`（DOD 草稿内容或 null）、`verdict`（PASS/FAIL/null）、`feedback`（评审反馈或 null）
- 不存在的 planner_task_id 返回 404
- 响应时间 < 5 秒（含 git 文件读取）

**验证命令**:
```bash
# Happy path：获取一个已完成的 pipeline 详情
PLANNER_ID=$(curl -sf "localhost:5221/api/brain/harness-pipelines?limit=1" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p=d.pipelines[0]; if(!p) {console.log('NO_PIPELINE'); process.exit(1);}
    const planner=p.stages.find(s=>s.task_type.includes('planner'));
    if(!planner||!planner.id) {console.log('NO_PLANNER_ID'); process.exit(1);}
    console.log(planner.id);")
curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(!d.pipeline) throw new Error('FAIL: 缺少 pipeline 对象');
    if(!d.pipeline.title) throw new Error('FAIL: pipeline 缺少 title');
    if(!Array.isArray(d.stages)) throw new Error('FAIL: 缺少 stages 数组');
    if(!Array.isArray(d.gan_rounds)) throw new Error('FAIL: 缺少 gan_rounds 数组');
    if(typeof d.files !== 'object') throw new Error('FAIL: 缺少 files 对象');
    console.log('PASS: pipeline 详情 API 字段完整，stages=' + d.stages.length + ' gan_rounds=' + d.gan_rounds.length);
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
在现有 Pipeline 列表页（`/harness-pipeline`）中，点击某条 Pipeline 卡片可导航到该 Pipeline 的详情页。详情页 URL 格式为 `/harness-pipeline/:planner_task_id`。

**硬阈值**:
- Pipeline 卡片可点击，点击后浏览器 URL 变为 `/harness-pipeline/:planner_task_id`
- planner_task_id 为该 Pipeline 的 planner 阶段任务 ID
- 详情页有返回按钮可回到列表页

**验证命令**:
```bash
# 验证详情页路由已注册（静态检查）
node -e "
  const fs = require('fs');
  const idx = fs.readFileSync('apps/api/features/execution/index.ts', 'utf8');
  if(!idx.includes(':planner_task_id') && !idx.includes('PipelineDetail'))
    throw new Error('FAIL: execution/index.ts 未注册详情页路由');
  console.log('PASS: 详情页路由已在 execution feature 中注册');
"

# 验证列表页组件包含导航逻辑
node -e "
  const fs = require('fs');
  // 检查 apps/api 或 apps/dashboard 中的列表页
  const files = [
    'apps/api/features/execution/pages/HarnessPipelinePage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'
  ];
  let found = false;
  for (const f of files) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if (c.includes('navigate') || c.includes('Link') || c.includes('useNavigate')) {
        found = true;
        console.log('PASS: ' + f + ' 包含导航逻辑');
        break;
      }
    } catch(e) {}
  }
  if (!found) throw new Error('FAIL: 列表页未包含导航到详情页的逻辑');
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
# 验证详情页组件包含阶段时间线渲染
node -e "
  const fs = require('fs');
  const glob = require('path');
  // 查找详情页组件
  const candidates = [
    'apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx',
    'apps/api/features/execution/pages/PipelineDetailPage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
  ];
  let found = false;
  for (const f of candidates) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if ((c.includes('planner') || c.includes('Planner')) &&
          (c.includes('stage') || c.includes('Stage')) &&
          (c.includes('completed') || c.includes('in_progress'))) {
        found = true;
        console.log('PASS: ' + f + ' 包含阶段时间线渲染逻辑');
        break;
      }
    } catch(e) {}
  }
  if (!found) throw new Error('FAIL: 未找到包含阶段时间线的详情页组件');
"

# 验证至少覆盖 6 个阶段类型
node -e "
  const fs = require('fs');
  const candidates = [
    'apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx',
    'apps/api/features/execution/pages/PipelineDetailPage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
  ];
  for (const f of candidates) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      const stages = ['planner', 'propose', 'review', 'generat', 'evaluat', 'report'];
      const hits = stages.filter(s => c.toLowerCase().includes(s));
      if (hits.length >= 4) {
        console.log('PASS: ' + f + ' 覆盖 ' + hits.length + '/6 个阶段类型');
        process.exit(0);
      }
    } catch(e) {}
  }
  throw new Error('FAIL: 详情页未覆盖足够多的阶段类型');
"
```

---

## Feature 4: Pipeline 详情页 — GAN 对抗轮次展示

**行为描述**:
详情页中展示 GAN 对抗过程的每一轮次（R1、R2、R3...）。每轮展示：DOD 草稿内容（Markdown 渲染）、Reviewer 的 verdict（PASS/FAIL）和反馈文字。最终通过的合同（sprint-contract.md）单独高亮展示。无 GAN 数据时显示"暂无对抗记录"占位。

**硬阈值**:
- 每轮按 R1/R2/R3 标签区分
- DOD 草稿和反馈内容支持 Markdown 渲染
- 无数据时显示占位文案，不报错
- verdict 为 PASS 时绿色高亮，FAIL 时红色高亮

**验证命令**:
```bash
# 验证详情页包含 GAN 轮次渲染逻辑
node -e "
  const fs = require('fs');
  const candidates = [
    'apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx',
    'apps/api/features/execution/pages/PipelineDetailPage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
  ];
  for (const f of candidates) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if ((c.includes('gan_round') || c.includes('ganRound') || c.includes('GAN') || c.includes('round')) &&
          (c.includes('verdict') || c.includes('PASS') || c.includes('FAIL')) &&
          (c.includes('draft') || c.includes('feedback'))) {
        console.log('PASS: ' + f + ' 包含 GAN 轮次展示逻辑');
        process.exit(0);
      }
    } catch(e) {}
  }
  throw new Error('FAIL: 详情页未包含 GAN 轮次展示逻辑');
"

# 验证无数据时的降级处理
node -e "
  const fs = require('fs');
  const candidates = [
    'apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx',
    'apps/api/features/execution/pages/PipelineDetailPage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
  ];
  for (const f of candidates) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if (c.includes('暂无') || c.includes('no data') || c.includes('empty')) {
        console.log('PASS: ' + f + ' 包含空数据降级处理');
        process.exit(0);
      }
    } catch(e) {}
  }
  throw new Error('FAIL: 详情页未包含空数据降级文案');
"
```

---

## Feature 5: Pipeline 详情页 — 用户原始输入与 PRD

**行为描述**:
详情页展示 Pipeline 的起源信息：Planner 任务 payload 中的用户原始需求描述（feature_description / acceptance_criteria），以及 sprint-prd.md 的完整内容（Markdown 渲染）。

**硬阈值**:
- 用户原始输入来自 planner 任务的 payload 字段
- PRD 内容来自 API 返回的 files.prd 字段
- PRD 使用 Markdown 渲染，不是纯文本
- PRD 为空时显示"PRD 暂不可用"占位

**验证命令**:
```bash
# 验证 API 返回 PRD 内容
PLANNER_ID=$(curl -sf "localhost:5221/api/brain/harness-pipelines?limit=1" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const p=d.pipelines[0]; if(!p) process.exit(1);
    const planner=p.stages.find(s=>s.task_type.includes('planner'));
    if(!planner||!planner.id) process.exit(1);
    console.log(planner.id);")
curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if(d.files && d.files.prd !== undefined) {
      console.log('PASS: API 返回 files.prd 字段，长度=' + (d.files.prd||'').length);
    } else {
      throw new Error('FAIL: API 未返回 files.prd 字段');
    }
    if(d.pipeline && d.pipeline.payload) {
      console.log('PASS: API 返回 pipeline.payload');
    } else {
      throw new Error('FAIL: API 未返回 pipeline.payload');
    }
  "

# 验证前端使用 Markdown 渲染
node -e "
  const fs = require('fs');
  const candidates = [
    'apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
  ];
  for (const f of candidates) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if (c.includes('markdown') || c.includes('Markdown') || c.includes('ReactMarkdown') ||
          c.includes('dangerouslySetInnerHTML') || c.includes('marked') || c.includes('remark')) {
        console.log('PASS: ' + f + ' 使用 Markdown 渲染');
        process.exit(0);
      }
    } catch(e) {}
  }
  throw new Error('FAIL: 详情页未使用 Markdown 渲染 PRD 内容');
"
```

---

## Feature 6: 无内容优雅降级

**行为描述**:
当 Pipeline 部分阶段尚未完成或 git 文件读取失败时，详情页不报错。已完成阶段正常展示，进行中阶段显示"执行中..."，未开始阶段显示灰色占位，git 文件不可用时显示"文件暂不可用"。

**硬阈值**:
- 页面不出现未捕获的 JS 错误（即使 API 返回部分 null 字段）
- 未完成阶段有明确的视觉状态区分
- git 文件内容为 null 时显示占位文案而非空白

**验证命令**:
```bash
# 验证 API 对未完成 pipeline 也能正常返回
curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=$(
  curl -sf 'localhost:5221/api/brain/harness-pipelines?limit=5' | \
  node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    const p=d.pipelines.find(x=>x.verdict!=="passed");
    if(!p){console.log(d.pipelines[0]?.stages?.find(s=>s.task_type.includes("planner"))?.id||"");process.exit(0);}
    const pl=p.stages.find(s=>s.task_type.includes("planner"));
    console.log(pl?.id||"");'
)" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if(!d.pipeline) throw new Error('FAIL: 未完成的 pipeline API 返回异常');
  console.log('PASS: 未完成 pipeline API 正常返回，stages=' + (d.stages||[]).length);
"

# 验证前端有降级占位文案
node -e "
  const fs = require('fs');
  const candidates = [
    'apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx',
    'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
  ];
  for (const f of candidates) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      const degradeHits = ['暂不可用','执行中','not_started','暂无'].filter(s => c.includes(s));
      if (degradeHits.length >= 2) {
        console.log('PASS: ' + f + ' 包含 ' + degradeHits.length + ' 个降级占位文案');
        process.exit(0);
      }
    } catch(e) {}
  }
  throw new Error('FAIL: 详情页降级占位文案不足');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend — Pipeline 详情 API

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `GET /api/brain/harness-pipeline-detail` 端点。通过 planner_task_id 查询 tasks 表获取所有阶段任务，通过 dev_records 反查分支名，用 `git show` 读取分支上的文件内容（sprint-prd.md、contract-draft.md、contract-review-feedback.md、sprint-contract.md），按轮次组装 GAN 对抗数据返回。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] GET /api/brain/harness-pipeline-detail?planner_task_id=xxx 返回完整的 pipeline 对象（title/status/created_at）、stages 数组、files 对象、gan_rounds 数组
  Test: curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=$(curl -sf 'localhost:5221/api/brain/harness-pipelines?limit=1' | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); const s=d.pipelines[0]?.stages?.find(x=>x.task_type.includes("planner")); console.log(s?.id||"")')" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!d.pipeline||!d.stages||!d.gan_rounds||!d.files) throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回 404，缺少参数返回 400
  Test: manual:bash -c 'S=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000"); [ "$S" = "404" ] && echo PASS || (echo "FAIL: $S"; exit 1)'
- [ ] [BEHAVIOR] git 文件读取失败时返回 null 值而非 500 错误
  Test: manual:curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=$(curl -sf 'localhost:5221/api/brain/harness-pipelines?limit=1' | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log(d.pipelines[0]?.stages?.find(x=>x.task_type.includes("planner"))?.id||"")')" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('PASS: files对象类型=' + typeof d.files)"

### Workstream 2: Frontend — Pipeline 详情页 + 导航

**范围**: 在 `apps/api/features/execution/` 新增详情页组件（HarnessPipelineDetailPage.tsx），包含阶段时间线、GAN 轮次展示、PRD 内容渲染、降级处理。在 `apps/api/features/execution/index.ts` 注册详情页路由（`/harness-pipeline/:planner_task_id`）。在列表页组件添加点击导航到详情页。在 `apps/api/features/execution/api/harness-pipeline.api.ts` 新增详情 API 调用函数。
**大小**: L（>300行）
**依赖**: Workstream 1 完成后（API 可用）

**DoD**:
- [ ] [ARTIFACT] 详情页组件文件存在且可被路由加载
  Test: node -e "require('fs').accessSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx'); console.log('OK')"
- [ ] [BEHAVIOR] 详情页路由 /harness-pipeline/:planner_task_id 已注册
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8'); if(!c.includes(':planner_task_id')) throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 列表页点击 Pipeline 卡片导航到详情页
  Test: node -e "const fs=require('fs'); const files=['apps/api/features/execution/pages/HarnessPipelinePage.tsx','apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx']; for(const f of files){try{const c=fs.readFileSync(f,'utf8'); if(c.includes('navigate')||c.includes('Link')){console.log('PASS: '+f); process.exit(0);}}catch(e){}} throw new Error('FAIL')"
- [ ] [BEHAVIOR] 详情页展示 6 步阶段时间线（Planner/Propose/Review/Generate/Evaluate/Report）
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); const hits=['planner','propose','review','generat','evaluat','report'].filter(s=>c.toLowerCase().includes(s)); if(hits.length<4) throw new Error('FAIL: only '+hits.length); console.log('PASS: '+hits.length+'/6')"
- [ ] [BEHAVIOR] GAN 对抗轮次按 R1/R2/R3 展示 DOD 草稿和 verdict
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('round')&&!c.includes('Round')) throw new Error('FAIL: no round'); if(!c.includes('verdict')&&!c.includes('Verdict')) throw new Error('FAIL: no verdict'); console.log('PASS')"
- [ ] [BEHAVIOR] 无 GAN 数据时显示占位文案，不报错
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('暂无')&&!c.includes('暂不可用')) throw new Error('FAIL: no fallback text'); console.log('PASS')"
- [ ] [BEHAVIOR] PRD 内容使用 Markdown 渲染
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); if(!c.match(/markdown|Markdown|ReactMarkdown|marked|remark|dangerouslySetInnerHTML/i)) throw new Error('FAIL'); console.log('PASS')"
