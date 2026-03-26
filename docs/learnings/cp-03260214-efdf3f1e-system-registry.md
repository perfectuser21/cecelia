# Learning: feat(brain) system_registry 表 + /api/brain/registry 接口

**Branch**: cp-03260214-efdf3f1e-f072-4dc3-aebe-f848ed
**Date**: 2026-03-26

## 做了什么

新增 `system_registry` 表（migration 197）+ 完整 CRUD API（5 个端点），让 Claude 创建任何组件前可先查询是否已存在，解决孤岛和重复问题。

## 根本原因（坑点）

### 1. EXPECTED_SCHEMA_VERSION 测试需要同步更新

每次新增 migration 并 bump `EXPECTED_SCHEMA_VERSION` 后，以下 3 个测试文件也需要同步更新：
- `selfcheck.test.js` — 直接断言版本号
- `desire-system.test.js` — D9 测试断言版本号
- `learnings-vectorize.test.js` — 顺带断言版本号

这些测试在上下文压缩后容易被遗漏。

### 2. pg 参数占位符不能复用同一 `$N` 两次

错误写法：
```js
params.push(`%${query}%`);
conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
```
pg 驱动要求每个 `$N` 对应 `params[N-1]` 的独立绑定，同一个 `$N` 不能在同一 SQL 中出现两次。

正确写法：push 两次值，使用两个不同占位符 `$n1` 和 `$n2`。

### 3. DoD GATE 测试格式必须 CI 兼容

`manual:npm test` 在 CI 中失败（无 node_modules）。应使用 `tests/` 引用路径或 `node -e` 检查文件。

## 下次预防

- [ ] 新增 migration 时，grep `EXPECTED_SCHEMA_VERSION` 找到所有测试文件一并更新
- [ ] SQL 双字段 ILIKE 搜索，始终 push 两次参数值（不复用 `$N`）
- [ ] DoD GATE 首选 `tests/` 路径，不用 `manual:npm test`
