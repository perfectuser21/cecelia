# Learning: P2P 回调路由表化

branch: cp-03231717-p2p-callback-routing
date: 2026-03-23

## 做了什么

将 ops.js 中 hardcode 的 `task_type === 'explore'` 判断替换为从 `task-router.js` 读取的 `ASYNC_CALLBACK_TYPES` 路由表，同时把 `research` 也加入支持范围。

## 核心设计

```
task-router.js 维护 ASYNC_CALLBACK_TYPES Set
ops.js 查表: ASYNC_CALLBACK_TYPES.has(task_type)
扩展新能力 = 路由表加一行，零代码改动
```

## 教训

1. **配置驱动优于代码驱动**：每次加能力都改业务逻辑代码是反模式，路由表把"扩展点"和"执行逻辑"分离。
2. **已有路由表就用**：task-router.js 已有 `VALID_TASK_TYPES` 和 `SKILL_WHITELIST`，新增 `ASYNC_CALLBACK_TYPES` 符合现有模式，不引入新抽象。
3. **测试验证 hardcode 消失**：测试里加 `not.toContain("task_type === 'explore'")` 防止将来回归。
