### 根本原因

Harness Pipeline 列表页（`/pipeline`）与现有 LangGraph 模式脱节，UX 不一致：

1. `GET /api/brain/harness-pipelines` 仍按 `sprint_dir` 聚合 6 个老 Harness 子 task（`harness_contract_propose` / `harness_generate` / `harness_ci_watch` …）。但 Harness v5.x 起，LangGraph 模式下**一个 `harness_planner` task 包含全部 6 节点**，不再产生子 task，所以列表永远显示 `not_started`。
2. 页面没有「新建 Pipeline」按钮，开新 pipeline 只能在终端 `curl POST /api/brain/tasks`。
3. `HarnessPipelineStatsPage.tsx` 在两个 feature manifest 中都有引用（execution + system-hub），但**没有路由**，用户访问不到，属于无主代码。

### 修复方式

1. **Brain API**：`packages/brain/src/routes/status.js` 改为以 `harness_planner` task 为主轴，按 `task_id` 查 `cecelia_events.langgraph_step` 事件聚合 `current_node / verdict / gan_rounds / fix_rounds / pr_url`。对无 langgraph 事件的老任务，fallback 到 `sprint_dir` 聚合旧子 task。
2. **Dashboard**：`HarnessPipelinePage.tsx` 消费新 `langgraph` 字段，展示「正在 Evaluator · R4: PASS · GAN 2 轮 · Fix 4 轮」摘要 + LangGraph/P0 badge + PR 链接。老任务仍走阶段徽章。
3. **新建 Modal**：顶栏「+ 新建 Pipeline」按钮 → 三字段（标题/描述/优先级）→ `POST /api/brain/tasks` → 跳 `/pipeline/:id` 详情页。
4. **删无主 Stats 页**：删 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStatsPage.tsx` + `apps/api/features/execution/pages/HarnessPipelineStatsPage.tsx`，清 feature manifest 两处 componentMap 引用。

### 下次预防

- [ ] 前端消费 Brain API 时，要针对「数据源已升级」的 case 做 fallback。不是简单重写，而是新老同时兼容（看 `summarizeLangGraphEvents` 返回 null → 走 legacy stages 分支）
- [ ] 新页面加 feature manifest 引用前，必须在 `routes` 区块里有对应 `path`，否则是死代码
- [ ] Brain 列表聚合端点应把「主轴资源」和「子事件」分两步查（planner 优先按 task 维度，子事件一次批量拉），避免 N+1
- [ ] 单元测试拆纯函数：`summarizeLangGraphEvents`/`buildPipelineRecord` 都可直接 export + 测试，不需要启 DB
