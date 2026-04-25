task_id: 1d904af8-0dd2-45d3-823c-1f18920a41a9
branch: cp-0425185111-p0-harness-bypass-backpressure

## 任务标题

[Harness v6 P1-A] P0 harness_task 跳过 backpressure（dispatch whitelist）

## 任务描述

`BACKPRESSURE_THRESHOLD=20 + burst=3` 让 P0 `harness_*` 任务被 88 个 P1 content-pipeline 积压拖累。
本 PR 在 slot-allocator.js 加 `BACKPRESSURE_BYPASS_TASK_TYPES` 白名单（8 个 harness_* 类型），
并在 `getBackpressureState({task})` 与 `dispatch-helpers.selectNextDispatchableTask` 中识别 P0 harness 跳过 backpressure。

## DoD

- [x] [ARTIFACT] slot-allocator.js 含 BACKPRESSURE_BYPASS_TASK_TYPES 常量
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');if(!/BACKPRESSURE_BYPASS_TASK_TYPES/.test(c))process.exit(1)"

- [x] [ARTIFACT] slot-allocator.js 含 shouldBypassBackpressure 函数
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');if(!/function shouldBypassBackpressure/.test(c))process.exit(1)"

- [x] [ARTIFACT] dispatch-helpers.js 引用 shouldBypassBackpressure
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatch-helpers.js','utf8');if(!/shouldBypassBackpressure/.test(c))process.exit(1);if(!/_bypass_backpressure/.test(c))process.exit(1)"

- [x] [BEHAVIOR] shouldBypassBackpressure 真值表测试（P0 harness=true，P1 harness=false，P0 content=false）
  Test: packages/brain/src/__tests__/slot-allocator.test.js

- [x] [BEHAVIOR] getBackpressureState({queue_depth:200, task: P0 harness_task}) → active=false, override_burst_limit=null
  Test: packages/brain/src/__tests__/slot-allocator.test.js

- [x] [BEHAVIOR] getBackpressureState({queue_depth:200, task: P1 content-pipeline}) → active=true, override_burst_limit=3（保持原行为）
  Test: packages/brain/src/__tests__/slot-allocator.test.js

- [x] [BEHAVIOR] dispatch-helpers 静态合同测试：源码含 shouldBypassBackpressure 引用 + _bypass_backpressure 标记
  Test: packages/brain/src/__tests__/slot-allocator.test.js

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0425185111-p0-harness-bypass-backpressure.md')"

## 目标文件

- packages/brain/src/slot-allocator.js
- packages/brain/src/dispatch-helpers.js
- packages/brain/src/__tests__/slot-allocator.test.js
- packages/brain/src/__tests__/dispatch-preflight-skip.test.js
- packages/brain/src/__tests__/initiative-lock.test.js
- packages/brain/src/__tests__/dispatcher-quota-cooling.test.js
- packages/brain/src/__tests__/dispatch-executor-fail.test.js
- docs/learnings/cp-0425185111-p0-harness-bypass-backpressure.md
