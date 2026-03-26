# Learning: feat(brain) system_registry 表 + /api/brain/registry 接口

**Branch**: cp-03260214-efdf3f1e-f072-4dc3-aebe-f848ed
**Date**: 2026-03-26

## 做了什么

新增 `system_registry` 表（migration 197）+ 完整 CRUD API（5 个端点），让 Claude 创建任何组件前可先查询是否已存在，解决孤岛和重复问题。

### 根本原因

每次新增 migration 并 bump `EXPECTED_SCHEMA_VERSION` 后，`selfcheck.test.js`、`desire-system.test.js`、`learnings-vectorize.test.js` 三个测试文件里的版本断言也必须同步更新，上下文压缩后容易遗漏导致 Gate 1 失败。

pg 驱动要求每个 `$N` 占位符对应 `params` 数组独立位置，双字段 ILIKE 搜索若复用同一 `$N` 两次会导致查询错误，需 push 两次值使用两个不同编号。

DoD 成功标准里的 `- [ ]` 条目同样需要 `Test:` 字段，否则 check-dod-mapping.cjs 会报"缺少 Test 字段"；`[PRESERVE]/[BEHAVIOR]` 条目若用 localhost HTTP 检查在 CI 无服务环境下必然失败，需改为文件检查或 `tests/` 引用。

## 下次预防

- [ ] 新增 migration 时，grep `EXPECTED_SCHEMA_VERSION` 找到所有测试文件一并更新
- [ ] SQL 双字段 ILIKE 搜索，始终 push 两次参数值（不复用 `$N`）
- [ ] DoD GATE 首选 `tests/` 路径，不用 `manual:npm test`
