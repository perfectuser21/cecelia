# DoD: shepherd/quarantine 跳过活跃任务

**分支**：cp-04232338-shepherd-skip-active

## Definition of Done

- [x] [ARTIFACT] 新增 `hasActiveCheckpoint` 函数到 `packages/brain/src/quarantine.js`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');if(!c.includes('async function hasActiveCheckpoint'))process.exit(1);if(!c.includes('FROM checkpoints WHERE thread_id'))process.exit(1)"

- [x] [ARTIFACT] `handleTaskFailure` 入口加 active checkpoint 守卫
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');if(!c.includes('const isActive = await hasActiveCheckpoint(taskId)'))process.exit(1);if(!c.includes('skipped_active'))process.exit(1)"

- [x] [ARTIFACT] 新增单元测试文件 `quarantine-skip-active-checkpoint.test.js`
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/quarantine-skip-active-checkpoint.test.js')"

- [x] [BEHAVIOR] hasActiveCheckpoint 能正确区分活跃/非活跃任务，handleTaskFailure 对活跃任务返回 skipped_active 并不写 tasks 表
  Test: tests/packages/brain/src/__tests__/quarantine-skip-active-checkpoint.test.js

- [x] [BEHAVIOR] 已有 quarantine-block / quarantine-billing-pause 测试在 mock 中加入 checkpoint 查询空结果后仍全部通过
  Test: tests/packages/brain/src/__tests__/quarantine-block.test.js

## 成功标准

1. 新测试 6 项全部通过
2. quarantine-block / quarantine-billing-pause / quarantine-learning-integration 等既有测试不回归
3. 活跃 Initiative 的 task（checkpoints 表有行）调 handleTaskFailure 返回 `{ skipped_active: true }`
