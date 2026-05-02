# DoD: brain-test-pyramid L3 PR1 — okr-task-progress-loop

- [x] **[ARTIFACT]** 新增 `packages/brain/src/__tests__/integration/okr-task-progress-loop.integration.test.js`
  - Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/okr-task-progress-loop.integration.test.js')"`
- [x] **[BEHAVIOR]** recalculate-progress 返回 0/33.33/100 基于 task 完成状态
  - Test: `tests/integration/okr-task-progress-loop.integration.test.js`
- [x] **[BEHAVIOR]** key_results.current_value 持久化验证
  - Test: `tests/integration/okr-task-progress-loop.integration.test.js`
- [x] **[BEHAVIOR]** 不存在的 KR → 404
  - Test: `tests/integration/okr-task-progress-loop.integration.test.js`
