# DoD: brain-test-pyramid L3 PR2 — learning-loop

- [x] **[ARTIFACT]** 新增 `packages/brain/src/__tests__/integration/learning-loop.integration.test.js`
  - Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/learning-loop.integration.test.js')"`
- [x] **[BEHAVIOR]** design-doc 创建后 GET/:id 可检索到相同内容
  - Test: `tests/integration/learning-loop.integration.test.js`
- [x] **[BEHAVIOR]** strategic-decision 创建后 matchDecisions 能按 topic 关键词召回
  - Test: `tests/integration/learning-loop.integration.test.js`
- [x] **[BEHAVIOR]** 缺少必填字段 → 400
  - Test: `tests/integration/learning-loop.integration.test.js`
