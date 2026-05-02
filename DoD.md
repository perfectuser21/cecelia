# DoD — brain-test-pyramid L2 PR3: tenant-onboarding integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js')"`

- [x] [BEHAVIOR] INSERT okr_projects DB 直查字段正确持久化
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] UPDATE status 状态变更持久化到 DB
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] upsert 幂等操作字段正确更新
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] 软删除（archived）后从活跃列表消失
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 okr_projects 数据
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`
