# Learning: KR5 Dashboard — Harness Pipeline 3 大阻断 Bug

## 根本原因

Harness Pipeline 模块在 v5.0 重构时存在三处路由/类型不一致问题：

1. **返回按钮路由残留**：`HarnessPipelineDetailPage` 的返回按钮硬编码了旧路由 `/pipeline`，但实际路由已重命名为 `/harness-pipeline`（在 `execution/index.ts` 中注册）。
2. **API 类型缺字段**：`harness-pipeline.api.ts` 中 `HarnessPipeline` 接口未包含 `planner_task_id` 字段，而 Brain API 实际返回该字段，导致无法从列表导航到详情页。
3. **新列表页缺详情入口**：新版 `HarnessPipelinePage`（execution 版本）重写时只做了 expand 展开，未复用旧版的 navigate 到详情页逻辑。

## 下次预防

- [ ] 重命名路由时，全文搜索所有 `navigate('/old-route')` 和 `href="/old-route"` 引用
- [ ] 新增 API 字段时同步更新前端 TypeScript 接口（`harness-pipeline.api.ts`）
- [ ] 重写页面时检查旧版的导航逻辑是否需要保留
- [ ] 路由对应组件注释中明确当前生效的路由路径（防止新旧路由混淆）
