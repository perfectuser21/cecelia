## brain-test-pyramid Layer 2 PR4: snapshots-ingest integration test（2026-05-02）

### 根本原因
llm_usage_snapshots 聚合查询（AVG/MAX/COUNT + 时间过滤）逻辑无法通过 mock 验证正确性，需要真实 DB 执行 SQL 聚合函数。

### 下次预防
- [ ] 新增 tick 定时写入的统计快照表时，添加 integration test 覆盖聚合查询链路
- [ ] 时间范围过滤必须单独验证，防止边界条件错误
