# DoD — brain-test-pyramid PR1: decisions-lifecycle integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js')"`

- [x] [BEHAVIOR] POST /api/brain/strategic-decisions 创建决策返回 id + status=active，DB 持久化
  Test: `packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js`

- [x] [BEHAVIOR] GET ?status=active 能查到刚创建的决策
  Test: `packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js`

- [x] [BEHAVIOR] PUT 更新 reason 字段持久化到 DB
  Test: `packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js`

- [x] [BEHAVIOR] PUT status=superseded 后从 active 列表消失
  Test: `packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js`

- [x] [BEHAVIOR] 测试 afterAll 清理自身创建的数据（不污染业务数据）
  Test: `packages/brain/src/__tests__/integration/decisions-lifecycle.integration.test.js`
