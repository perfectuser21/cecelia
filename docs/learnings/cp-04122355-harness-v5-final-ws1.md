### 根本原因

Health 端点需要新增 evaluator_stats 聚合字段，统计 task_type='harness_evaluate' 的终态记录数量。
使用单条 SQL（COUNT FILTER + MAX）在 Promise.all 中并行执行，避免阻塞其他字段。

### 下次预防

- [ ] 新增 Health 字段时优先使用 Promise.all 并行，不串行
- [ ] SQL 查询必须加 .catch(() => null) 容错，防止 evaluator_stats 查询失败导致整个 health 500
- [ ] passed/failed 用 FILTER (WHERE ...) 而非多次查询，一次 SQL 获取所有统计
