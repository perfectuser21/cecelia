### 根本原因

实现 Health 端点新增 `active_pipelines` 字段：在 `packages/brain/src/routes/goals.js` 的 `/health` 路由中，将新 SQL 查询（`count(*)::integer` 统计 `task_type='harness_planner' AND status='in_progress'`）加入 `Promise.all` 并行执行，结果作为 `active_pipelines` 字段写入响应 JSON。
关键决策：
- `::integer` 强制类型转换确保返回整数而非字符串
- 使用 `Promise.all` 避免串行等待，响应时间增量最小

### 下次预防

- [ ] health 端点新增 DB 字段时，优先使用 `Promise.all` 并行
- [ ] 计数字段使用 `::integer` 强制转换，避免 pg 返回字符串导致类型检查失败
