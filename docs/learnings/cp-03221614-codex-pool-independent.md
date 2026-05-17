# Learning: Codex pool 独立于 task_pool

## 根本原因
`tick.js` dispatch 逻辑用 `dispatchAllowed`（基于 task_pool 空位）作全局开关。
xian 类任务（pr_review/codex_dev 等）走独立 Codex Bridge，不消耗 task_pool slot，
但 task_pool 满时 `dispatchAllowed=false` 把它们一起封锁了。

## 修复
在 `slotBudgetAfter.dispatchAllowed=false` 时加 xian bypass：
- 若 codex pool 有空位 (`codex.available=true`)
- 且下一个 queued 任务是 xian 类型（`getTaskLocation(type)==='xian'`）
- 则跳过 task_pool 限制，继续走 dispatch 流程

## 下次预防
- [ ] xian 类任务创建时，应标记 `bypass_task_pool: true`，避免每次 tick 都 peek DB
- [ ] `/api/brain/slots` 响应里加 `xian_bypass_active: bool`，方便监控
