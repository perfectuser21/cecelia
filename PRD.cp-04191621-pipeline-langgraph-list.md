# PRD: Harness Pipeline 前端 UX 一致性整顿

## 背景

Dashboard `/pipeline` 列表页展示的阶段状态与实际 LangGraph 运行状态脱节。LangGraph 模式下一个 `harness_planner` task 运行全部 6 节点，不产生子 task，列表页按 `sprint_dir` 聚合子 task 时永远显示 `not_started`。

同时缺少「新建 Pipeline」入口；`HarnessPipelineStatsPage` 无路由，属于死代码。

## 范围

1. 改 `GET /api/brain/harness-pipelines`：以 `harness_planner` task 为主轴，聚合 `cecelia_events.langgraph_step` 事件。老任务 fallback 到 sprint_dir 聚合。
2. 改 `HarnessPipelinePage.tsx`：消费 `langgraph` 字段展示进度；顶部加「+ 新建 Pipeline」按钮与 Modal。
3. 删 `HarnessPipelineStatsPage.tsx` 与其两处 manifest 引用。

## 不在范围

- 不改 `HarnessPipelineDetailPage` / `HarnessPipelineStepPage`
- 不改 `pipeline-detail` API
- 不改 LangGraph runner / executor.js
- 不改 `POST /api/brain/tasks`

## 成功标准

- 真实任务 `8b4a13eb-4f2c-4317-98ba-2d08a64c31c0` 在列表 API 返回正确 `langgraph.current_node=report`、`gan_rounds=2`、`fix_rounds=4`、`total_steps=14`
- 前端列表显示「正在 Evaluator · R4: PASS · GAN 2 轮 · Fix 4 轮」之类摘要
- 新建 Modal 能通过 `POST /api/brain/tasks` 创建 `harness_planner` 任务，跳转详情页
- 全部前后端单元测试通过
