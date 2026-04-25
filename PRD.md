# PRD: P0 harness 跳过 backpressure（dispatch whitelist）

**日期**：2026-04-25
**分支**：cp-0425185111-p0-harness-bypass-backpressure
**Brain 任务**：1d904af8-0dd2-45d3-823c-1f18920a41a9

## 背景

`BACKPRESSURE_THRESHOLD=20 + burst=3` 让 P0 `harness_*` 任务被 88 个 P1 content-pipeline 积压拖累。
今晚 bb245cb4 跑期间反复看到 `queue_depth=128 > 20 burst_limit=3` 卡 dispatch。
Harness v6 Phase B 的 P0 harness_task / harness_ci_watch / harness_deploy_watch 等关键调度链被次要的 content 任务积压扼住。

## 方案

让 8 个 P0 `harness_*` task 在 backpressure 触发时跳过 burst limit，同时不影响其它任务的 backpressure 行为：

1. `packages/brain/src/slot-allocator.js` 新增白名单常量 `BACKPRESSURE_BYPASS_TASK_TYPES`（8 个 `harness_*`）
2. 新增 `shouldBypassBackpressure(task)` 工具函数：priority='P0' AND task_type 在白名单 → true
3. `getBackpressureState({task})` 接受可选 `task` 参数：匹配白名单时短路返回 `active=false, override_burst_limit=null, bypassed:true`
4. `packages/brain/src/dispatch-helpers.js::selectNextDispatchableTask` 给匹配候选 task 打 `_bypass_backpressure: true` 标记，调用方可识别

## 做

1. slot-allocator.js 加常量、加 `shouldBypassBackpressure`、修改 `getBackpressureState` 签名 + 短路逻辑、补 export
2. dispatch-helpers.js import `shouldBypassBackpressure` + 选中 task 后打标记
3. slot-allocator.test.js 新增白名单真值表 + getBackpressureState({task}) bypass 行为测试 + dispatch-helpers 引用合同测试（共 10 条 it）
4. 4 个 mock 文件（dispatch-preflight-skip、initiative-lock、dispatcher-quota-cooling、dispatch-executor-fail）补 `shouldBypassBackpressure: vi.fn(() => false)` 导出
5. 写 Learning 文档

## 不做

- 不改 BACKPRESSURE_THRESHOLD / BACKPRESSURE_BURST_LIMIT 数值
- 不改 tick.js dispatch loop 实际 burst 计数器（标记已打但 tick.js 行为更新留 follow-up）
- 不放行 P1 harness（PRD 明确只放 P0）

## 成功标准

- `slot-allocator.js` 含 `BACKPRESSURE_BYPASS_TASK_TYPES` 常量 + `shouldBypassBackpressure` 函数
- `getBackpressureState({queue_depth:200, task:{priority:'P0',task_type:'harness_task'}})` → `active=false, override_burst_limit=null`
- `getBackpressureState({queue_depth:200, task:{priority:'P1',task_type:'content-pipeline'}})` → `active=true, override_burst_limit=3`（保持原行为）
- `dispatch-helpers.js` import 并调用 `shouldBypassBackpressure`，给候选打 `_bypass_backpressure` 标记
- slot-allocator.test.js 全绿
- dispatch-preflight-skip / initiative-lock / dispatcher-quota-cooling / dispatch-executor-fail / select-next-claimed-filter 全绿
- Learning 文档存在
