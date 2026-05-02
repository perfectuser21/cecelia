# DoD — brain-test-pyramid L2 PR2: works-crud integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/works-crud.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/works-crud.integration.test.js')"`

- [x] [BEHAVIOR] POST /api/brain/publish-jobs 创建 job 返回 id + status=pending
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] GET /api/brain/publish-jobs 列表可查到刚创建的 job
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] DB 直查 payload 字段持久化正确
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] retry 接口将 failed job 重置为 pending
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 content_publish_jobs 数据
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`
