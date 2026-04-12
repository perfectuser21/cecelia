### 根本原因

在 GET /api/brain/health 端点中新增 `harness_pipeline_count` 字段，通过并行 SQL 查询获取
`status='in_progress' AND task_type='harness_planner'` 的任务数量，不影响现有响应结构。

### 下次预防

- [ ] 修改 health 端点时，用 Promise.all 并行新增查询，避免串行阻塞响应时间
- [ ] 新增字段前确认与已有字段同级（顶层），不嵌套在 organs 等子对象中
- [ ] 单元测试 mock pool.query 时验证 COUNT(*)::int 类型转换（PostgreSQL 返回字符串，需 ::int）
