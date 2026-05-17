# DoD: quarantine 扩展 skip-active 守卫至 docker container

**分支**：cp-04240815-quarantine-skip-container

## Definition of Done

- [x] [ARTIFACT] 新增 `hasActiveContainer` 函数到 `packages/brain/src/quarantine.js`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');if(!c.includes('async function hasActiveContainer'))process.exit(1);if(!c.includes('cecelia-task-'))process.exit(1);if(!c.includes('docker'))process.exit(1)"

- [x] [ARTIFACT] `handleTaskFailure` 在 checkpoint 守卫之后加 active container 守卫，返回 reason=active_container
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');if(!c.includes('const hasContainer = await hasActiveContainer(taskId)'))process.exit(1);if(!c.includes(\"reason: 'active_container'\"))process.exit(1)"

- [x] [ARTIFACT] 新增单元测试文件 `quarantine-skip-active-container.test.js`
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/quarantine-skip-active-container.test.js')"

- [x] [BEHAVIOR] hasActiveContainer 对三种分支（docker ps 命中/不命中/execFile 抛错）均正确返回 true/false
  Test: tests/packages/brain/src/__tests__/quarantine-skip-active-container.test.js

- [x] [BEHAVIOR] handleTaskFailure 对活跃容器任务返回 skipped_active=true + reason=active_container 且不累加 failure_count
  Test: tests/packages/brain/src/__tests__/quarantine-skip-active-container.test.js

- [x] [BEHAVIOR] 既有 quarantine-skip-active-checkpoint 测试（checkpoint 守卫）不回归
  Test: tests/packages/brain/src/__tests__/quarantine-skip-active-checkpoint.test.js

## 成功标准

1. 新测试 9 项（hasActiveContainer 5 项 + handleTaskFailure 守卫 4 项）全部通过
2. quarantine-skip-active-checkpoint / quarantine-block / quarantine-billing-pause / quarantine-learning-integration 等既有测试不回归（95/95 passed）
3. 活跃 Generator 类任务（cecelia-task-<hex> 容器在跑）调 handleTaskFailure 返回 `{ skipped_active: true, reason: 'active_container' }`
