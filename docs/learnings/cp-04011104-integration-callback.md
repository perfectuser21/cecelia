# Learning: Executor Callback 集成测试

### 根本原因
Brain 的 execution-callback 路由（POST /api/brain/execution-callback）从未被集成测试覆盖。所有现有测试都 mock 了 DB 层，无法验证 callback 是否真正持久化到 PostgreSQL。这意味着 callback → task 状态更新 → DB 这条核心链路在 CI 中存在盲区。

### 解决方案
使用真实 pg.Pool + fetch，不 mock 任何内部模块。skipIf 机制（`HAS_DB` 环境变量检查）确保无 DB 环境自动跳过，不影响 L3 单元测试。测试覆盖三个场景：success/failure/result payload。

### 下次预防
- [ ] 新增 callback 类型时同步添加集成测试
- [ ] callback 路由修改后必须跑 `RUN_INTEGRATION=true npx vitest run tests/integration/callback.integration.test.ts` 验证
- [ ] 集成测试命名使用 `TEST_INTEGRATION_` 前缀，便于 afterAll 统一清理，避免测试数据污染 DB
