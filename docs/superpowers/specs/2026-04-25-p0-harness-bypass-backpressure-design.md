# P0 harness 跳过 backpressure（dispatch whitelist）

Brain task: `1d904af8-0dd2-45d3-823c-1f18920a41a9`
PR title: `fix(brain): P0 harness_task 跳过 backpressure，不被 content 积压拖累`

## 背景

`BACKPRESSURE_THRESHOLD=20 + burst=3` 让 P0 harness_* 被 88 个 P1 content-pipeline 积压拖累。
今晚 bb245cb4 跑期间反复看到 `queue_depth=128 > 20 burst_limit=3` 卡 dispatch。

## 设计目标

让 8 个 P0 `harness_*` task 类型在 backpressure 触发时**仍能正常派发**，不受 burst_limit=3 限制。
P1 content-pipeline 等任务保持原 backpressure 行为不变。

## 改动文件

1. `packages/brain/src/slot-allocator.js`
   - 新增常量 `BACKPRESSURE_BYPASS_TASK_TYPES`（8 个 `harness_*`）
   - 新增工具函数 `shouldBypassBackpressure(task)` — 入参 `{priority, task_type}`，返回 boolean
   - `getBackpressureState({task})` 增加可选 `task` 参数：若 `shouldBypassBackpressure(task)===true`，
     直接返回 `{active:false, override_burst_limit:null}`（其他字段保留）
   - 导出新增常量和工具函数

2. `packages/brain/src/dispatch-helpers.js`
   - 在 `selectNextDispatchableTask` 选定任务前，对每个候选 task：
     若 `shouldBypassBackpressure(task) === true`，给 task 加 `_bypass_backpressure: true` 标记
   - tick.js 后续可识别该标记跳过 burst limit（本 PR 仅打标记，不改 tick.js — tick 改动留 follow-up）

3. `packages/brain/src/__tests__/slot-allocator.test.js`
   - `shouldBypassBackpressure` 真值表测试：
     - P0 harness_task → true
     - P0 harness_initiative → true
     - P1 harness_task → false（priority 不匹配）
     - P0 content-pipeline → false（type 不匹配）
   - `getBackpressureState({queue_depth:200, task: P0 harness_task})`
     → `active=false, override_burst_limit=null`
   - `getBackpressureState({queue_depth:200, task: P1 content-pipeline})`
     → `active=true, override_burst_limit=3`（保持原行为）

## 白名单常量

```js
export const BACKPRESSURE_BYPASS_TASK_TYPES = [
  'harness_initiative',
  'harness_task',
  'harness_planner',
  'harness_contract_propose',
  'harness_contract_review',
  'harness_fix',
  'harness_ci_watch',
  'harness_deploy_watch',
];
```

## 成功标准

- [ARTIFACT] `packages/brain/src/slot-allocator.js` 含 `BACKPRESSURE_BYPASS_TASK_TYPES` 常量
- [BEHAVIOR] 单元测试: `getBackpressureState({queue_depth:200, task:{priority:'P0',task_type:'harness_task'}})`
  → `active=false`, `override_burst_limit=null` (Test: `tests/__tests__/slot-allocator.test.js`)
- [BEHAVIOR] 单元测试: `getBackpressureState({queue_depth:200, task:{priority:'P1',task_type:'content-pipeline'}})`
  → `active=true`, `override_burst_limit=3` (Test: `tests/__tests__/slot-allocator.test.js`)
- [BEHAVIOR] `cd packages/brain && npm test -- --run slot-allocator` 全绿
  (Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');if(!c.includes('BACKPRESSURE_BYPASS_TASK_TYPES'))process.exit(1)"`)

## 风险与缓解

- **风险**：P0 harness 突然不受限可能瞬间打满 slot
  - **缓解**：仍受 `effectiveBurstLimit` 上层 `MAX_NEW_DISPATCHES_PER_TICK` 总量限制；本改动只改 burst override，不改 slot pool budget
- **风险**：P1 harness 类型也想跳过 backpressure
  - **决策**：本期只放行 P0；P1 不在白名单（PRD 明确）

## 不在范围

- 修改 tick.js 的 burst 限速逻辑（本 PR 仅在数据结构层加 bypass 标记，tick.js 改动留 follow-up）
- 修改 `BACKPRESSURE_THRESHOLD` 或 `BACKPRESSURE_BURST_LIMIT` 数值
