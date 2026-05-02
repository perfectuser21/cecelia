# DoD — brain-test-pyramid L2 PR1: publish-flow integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/publish-flow.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/publish-flow.integration.test.js')"`

- [x] [BEHAVIOR] POST /api/brain/publish-jobs 创建 job 返回 status=pending
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] DB 直写 running + 回写 results + GET 验证可查
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] retry 接口将 failed job 重置为 pending
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] 缺少 platform 或 success 类型错误返回 400
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 content_publish_jobs + publish_results 数据
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`
