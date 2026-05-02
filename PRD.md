# PRD — brain-test-pyramid L2 PR2: works-crud integration test

## 背景
content_publish_jobs CRUD 缺少 integration test，只有 mock 单元测试，无法验证真实 DB 持久化和 API 链路。

## 目标
为 content_publish_jobs 写完整 CRUD integration test：POST 创建 → GET 列表查询 → DB 直查 payload → retry 重置失败 → 参数校验。

## 成功标准

- [ ] works-crud.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] POST /api/brain/publish-jobs 创建 works，返回 id + status=pending
- [ ] GET /api/brain/publish-jobs 列表可查到新创建的 job
- [ ] DB 直查 payload 字段正确持久化
- [ ] retry 接口重置 failed 状态为 pending
- [ ] 参数错误返回 400
- [ ] afterAll 清理自身创建数据
