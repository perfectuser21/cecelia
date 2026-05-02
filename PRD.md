# PRD — brain-test-pyramid L2 PR1: publish-flow integration test

## 背景
content_publish_jobs 端到端发布流程缺少 integration test，现有单元测试全部 mock DB，无法验证真实持久化行为。

## 目标
为发布流程写完整 integration test：POST 创建 job（pending）→ DB 直写 running → POST publish-results → GET 验证可查 → DB 直写 success，以及失败路径 failed → retry → pending，参数校验 400 响应。

## 成功标准

- [ ] publish-flow.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] POST /api/brain/publish-jobs 创建 job，返回 status=pending
- [ ] POST /api/brain/publish-results 写入成功结果，GET 可查
- [ ] retry 接口重置 failed job 为 pending
- [ ] 缺少 platform 参数返回 400，success 类型错误返回 400
- [ ] afterAll 清理自身创建的数据
