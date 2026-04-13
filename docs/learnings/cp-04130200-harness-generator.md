### 根本原因

Harness v5.1 需要让 Evaluator Agent 能通过 `/api/brain/health` 感知当前 pipeline 版本。
在 `packages/brain/src/routes/goals.js` 的 health 端点 `res.json()` 返回对象中添加 `pipeline_version: '5.1'` 硬编码常量字段，不依赖数据库或环境变量。

### 下次预防

- [ ] health 端点新增字段时确认不破坏原有字段（status/uptime/active_pipelines/evaluator_stats/tick_stats/organs/timestamp）
- [ ] 硬编码版本号放在 res.json() 顶层，便于 Evaluator 快速提取
