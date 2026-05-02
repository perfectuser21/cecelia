# DoD — brain-test-pyramid L2 PR4: snapshots-ingest integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/snapshots-ingest.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/snapshots-ingest.integration.test.js')"`

- [x] [BEHAVIOR] INSERT 多条快照，SELECT 全量正确返回
  Test: `packages/brain/src/__tests__/integration/snapshots-ingest.integration.test.js`

- [x] [BEHAVIOR] COUNT/AVG/MAX 聚合查询结果正确
  Test: `packages/brain/src/__tests__/integration/snapshots-ingest.integration.test.js`

- [x] [BEHAVIOR] 时间范围过滤正确筛选数据
  Test: `packages/brain/src/__tests__/integration/snapshots-ingest.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 llm_usage_snapshots 数据
  Test: `packages/brain/src/__tests__/integration/snapshots-ingest.integration.test.js`
