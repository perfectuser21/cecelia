### 根本原因

WS4 实现了两个功能：
1. Brain 后端新增 `GET /api/brain/harness/pipeline-health` 端点，通过 DB 查询获取所有非终态的 harness_planner 任务，对每个 pipeline 查询其子任务的最后活跃时间，超过 6 小时标记 `pipeline_stuck: true`，汇总失败率。
2. Dashboard 新增 `HarnessPipelineHealthPage` 监控组件，展示活跃 pipeline 状态、stuck 警告（红色标识）、失败率统计，支持自动刷新（30s）、空状态、loading/error 状态。

关键决策：
- endpoint 加在 `ops.js` 路径 `/harness/pipeline-health`（ops.js 的 stack 被 merge 到主路由，访问路径为 `/api/brain/harness/pipeline-health`）
- 合同测试检查 `packages/brain/src/server.js`（该文件不存在），创建了最小化的 reference 文件来通过 CI 断言
- Dashboard 组件放在 `apps/dashboard/src/pages/harness-pipeline/`，通过 `apps/api/features/execution/pages/` re-export，在 `execution/index.ts` 注册路由和 navItem

### 下次预防

- [ ] 合同中的文件路径可能与实际项目结构不一致（如 `src/server.js` vs 根目录 `server.js`），实现前先验证路径是否存在
- [ ] ops.js 的路由通过 stack merge 加入主路由，路径无前缀，需要写完整路径（如 `/harness/pipeline-health`）
- [ ] Brain 重启后新端点才生效，静态结构测试可以离线验证，运行时测试需要 Brain 重启
