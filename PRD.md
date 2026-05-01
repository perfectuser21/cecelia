# PRD: brain-test-pyramid PR5 — alertness-state-behavior integration test

## 背景

`/api/brain/alertness` 端点目前只有存活检查，缺乏行为级验证。本 PR 是 brain-test-pyramid 项目第一层第五个 PR，补齐 Alertness 状态行为的 integration test。

## 目标

为 Alertness 状态行为写完整 integration test：读取当前 level → override → 验证变更 → 还原。

## 成功标准

- GET `/api/brain/alertness` 响应含 `level`/`levelName`/`reason`/`startedAt` 字段
- POST override 设置 level 后 GET 验证 level 已变更，reason 含 override 前缀
- POST override 无效参数（无 reason / level 超范围）返回 400
- POST clear-override 后 `override` 字段为 null
- afterAll 严格还原，不污染 Brain 全局状态

## DoD

- [x] [ARTIFACT] 测试文件存在：packages/brain/src/__tests__/integration/alertness-state-behavior.integration.test.js
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/alertness-state-behavior.integration.test.js')"

- [x] [BEHAVIOR] GET /api/brain/alertness 响应包含 level/levelName/reason/startedAt 字段
  Test: tests/packages/brain/src/__tests__/integration/alertness-state-behavior.integration.test.js

- [x] [BEHAVIOR] POST override 设置 level=2 后 GET 返回 level=2，reason 含 override 信息
  Test: tests/packages/brain/src/__tests__/integration/alertness-state-behavior.integration.test.js

- [x] [BEHAVIOR] POST override 无效参数（无 reason/level 超范围）返回 400
  Test: tests/packages/brain/src/__tests__/integration/alertness-state-behavior.integration.test.js

- [x] [BEHAVIOR] POST clear-override 后 override 字段为 null（状态已还原）
  Test: tests/packages/brain/src/__tests__/integration/alertness-state-behavior.integration.test.js
