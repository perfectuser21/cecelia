# DoD: Harness Pipeline 前端 UX 一致性整顿

## [ARTIFACT] 列表 API 源码升级

- [x] `packages/brain/src/routes/status.js` 新增 `summarizeLangGraphEvents` 和 `buildPipelineRecord` 两个纯函数，并 export
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes('summarizeLangGraphEvents')||!c.includes('buildPipelineRecord'))process.exit(1)"`

- [x] `packages/brain/src/routes/status.js` 的 `/harness-pipelines` 端点查询 `cecelia_events` 表 + 按 `task_id` 聚合 langgraph_step 事件
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes(\"event_type = 'langgraph_step'\"))process.exit(1)"`

## [ARTIFACT] StatsPage 删除

- [x] 删 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStatsPage.tsx`
  - Test: `manual:node -e "const fs=require('fs');if(fs.existsSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStatsPage.tsx'))process.exit(1)"`

- [x] 删 `apps/api/features/execution/pages/HarnessPipelineStatsPage.tsx`
  - Test: `manual:node -e "const fs=require('fs');if(fs.existsSync('apps/api/features/execution/pages/HarnessPipelineStatsPage.tsx'))process.exit(1)"`

- [x] 清 `apps/api/features/system-hub/index.ts` 和 `apps/api/features/execution/index.ts` 中的 `HarnessPipelineStatsPage` 引用
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8')+require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');if(c.includes('HarnessPipelineStatsPage'))process.exit(1)"`

## [BEHAVIOR] 列表聚合逻辑正确

- [x] 单元测试：`summarizeLangGraphEvents` 在 14 条真实事件下返回 `gan_rounds=2`、`fix_rounds=4`、`last_verdict='PASS'`、`current_node='report'`、`total_steps=14`
  - Test: `tests/packages/brain/src/__tests__/harness-pipelines-list.test.js`

- [x] 单元测试：`buildPipelineRecord` 在无 langgraph 事件时 fallback 到 legacy stages 聚合，`langgraph` 字段为 `null`
  - Test: `tests/packages/brain/src/__tests__/harness-pipelines-list.test.js`

## [BEHAVIOR] 前端 LangGraph 模式渲染

- [x] 单元测试：`formatLangGraphSummary` 在 `in_progress` / `completed` / `cancelled` 状态下分别输出「正在 X」/「已完成 (X)」/「已停在 X」
  - Test: `tests/apps/dashboard/src/pages/harness-pipeline/__tests__/HarnessPipelinePage.langgraph.test.ts`

- [x] 单元测试：`formatLangGraphSummary` 在 `current_node='evaluator'` 时使用 `eval_round` 作为 R 编号，在 `current_node='reviewer'` 时使用 `review_round`
  - Test: `tests/apps/dashboard/src/pages/harness-pipeline/__tests__/HarnessPipelinePage.langgraph.test.ts`

## [ARTIFACT] 新建 Pipeline 入口

- [x] `HarnessPipelinePage.tsx` 含 `NewPipelineModal` 组件，通过 `POST /api/brain/tasks` 提交 `task_type=harness_planner`
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('NewPipelineModal')||!c.includes(\"task_type: 'harness_planner'\"))process.exit(1)"`

- [x] 列表页顶栏有「新建 Pipeline」按钮
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('新建 Pipeline'))process.exit(1)"`
