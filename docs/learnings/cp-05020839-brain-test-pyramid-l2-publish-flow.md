## brain-test-pyramid Layer 2 PR1: publish-flow integration test（2026-05-02）

### 根本原因
发布流程测试全部 mock DB，无法验证 content_publish_jobs 真实持久化。Integration test 补全端到端链路验证。

### 下次预防
- [ ] 新增 publish 相关路由时，同步添加 integration test 覆盖 pending→running→success 链路
- [ ] 参数校验路径（400 响应）必须在 integration test 中单独验证
