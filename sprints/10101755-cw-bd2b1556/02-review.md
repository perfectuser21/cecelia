---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 8
可执行: 8

## 上轮问题
- R-1: 关闭 —— S-1 第 1 点已加 `loadAllowedCategories({ fresh: true })`，第 2 点改为缓存里没有该值时先重读约束，重读后仍没有才返回 400。验证里也补了「缓存过期」用例：先缓存旧列表，再 POST `retro`，断言重查约束、发出 INSERT、返回 201。线上用 psql 加宽约束后，合法值会被误拒的路径已经堵上。
- R-2: 关闭 —— S-1 已导出 `_resetAllowedCategoriesCache()`，单测在 `beforeEach` 调用。兜底用例改成约束查询抛错（返回 null，预检放行），再 POST `workflow_bogus`，并断言 INSERT 确实被调用、因 23514 返回 400、body 里没有约束名和 SQL 原文，catch 分支会真正执行到。另外核对了现有回归测试：`strategic-decisions-source-ref.test.js` 的 mock 一律返回 `{ rows:[{ id:'x' }] }`，没有 `def`，会解析成 null 并放行；它是用 `find` 按 SQL 找 INSERT，不靠调用顺序，所以不会被新增的约束查询打乱。`strategic-decisions.test.js` 里 `mockResolvedValueOnce` 的用例都不带 category，不会触发约束查询，也不会把 INSERT 用的一次性 mock 值提前吃掉。
