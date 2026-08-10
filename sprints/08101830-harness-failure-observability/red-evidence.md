# Red 证据 — harness-failure-class 契约测试（实现前全红）

命令: `node_modules/.bin/vitest run sprints/08101830-harness-failure-observability/tests/harness-failure-class.test.js --config vitest.config.js`

```
FAIL  sprints/08101830-harness-failure-observability/tests/harness-failure-class.test.js
Error: Failed to load url ../../../packages/brain/src/harness-failure-class.js — Does the file exist?
Test Files  1 failed (1)
     Tests  no tests
```

被测模块 `packages/brain/src/harness-failure-class.js` 尚未创建 → 契约测试无法加载 = 全红，符合 TDD Red 预期。
Green 阶段将新增该 SSOT 模块（FAILURE_CLASSES 冻结闭集 + isValidFailureClass + classifyFailure + buildTerminalFailureResult）使其转绿。
