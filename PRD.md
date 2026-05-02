# PRD — brain-test-pyramid L2 PR4: snapshots-ingest integration test

## 背景
llm_usage_snapshots 是系统 LLM 算力消耗历史快照表，由 tick 每日写入，供周报和选题引擎查询。当前缺少对写入和查询链路的 integration test，无法验证真实 DB 聚合行为。

## 目标
为 llm_usage_snapshots 写完整 integration test：INSERT 多条快照 → SELECT 全量 → 聚合查询（AVG/MAX/COUNT）→ 时间范围过滤 → 字段约束验证。

## 成功标准

- [ ] snapshots-ingest.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] INSERT 多条 llm_usage_snapshots，SELECT 全量正确返回
- [ ] COUNT/AVG/MAX 聚合查询结果正确
- [ ] 时间范围过滤正确筛选数据
- [ ] 字段约束（非负值等）验证
- [ ] afterAll 清理自身创建的 snapshots 数据
