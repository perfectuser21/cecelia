# Learning: P2P 回调路由表化

branch: cp-03231717-p2p-callback-routing
date: 2026-03-23

## 做了什么

将 ops.js 中 hardcode 的 `task_type === 'explore'` 判断替换为从 `task-router.js` 读取的 `ASYNC_CALLBACK_TYPES` 路由表，同时把 `research` 加入支持范围。

## 根本原因

每次新增 P2P 异步回调能力都要改 ops.js 业务逻辑，导致"改代码 → 走 /dev → CI → 合并"的完整流程，成本过高。根本原因是能力配置和执行逻辑耦合在同一文件。

## 解决方案

在 task-router.js 新增 `ASYNC_CALLBACK_TYPES` Set，ops.js 改为查表。扩展新能力只改路由表一行，无需走 /dev。

## 下次预防

- [ ] 新增 P2P 异步回调能力时，只改 `task-router.js` 中的 `ASYNC_CALLBACK_TYPES`
- [ ] 不要在 ops.js 中 hardcode 任何 task_type 判断
- [ ] 测试中用 `not.toContain("task_type === '...'")` 验证无 hardcode 回归

## 教训

配置驱动优于代码驱动：task-router.js 已有 `VALID_TASK_TYPES` 和 `SKILL_WHITELIST`，`ASYNC_CALLBACK_TYPES` 符合现有模式，不引入新抽象。
