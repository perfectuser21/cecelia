# PRD: selectNextDispatchableTask 加 claimed_by IS NULL 过滤

## 背景

PR #2389（C1）给 `tasks` 表加了 `claimed_by` / `claimed_at` 列 + 原子 claim 逻辑，用于防止多个 runner 并行 dispatch 同一任务重复。

但 `selectNextDispatchableTask`（`packages/brain/src/tick.js:752`）的 SELECT WHERE 子句**没有** `claimed_by IS NULL` 过滤，仍然会 return 已被别的 runner claim 的任务。后续原子 UPDATE 的 WHERE 捕获冲突（409），但这是浪费一轮 pre-flight。更严重：若 claim 过但 release 失败的任务（claimed_by 残留）将永远不会被后续 tick 正确选中。

## 范围（本 PR）

1. **改动** `packages/brain/src/tick.js:783` 的 SELECT WHERE，`AND t.status = 'queued'` 之后追加一行 `AND t.claimed_by IS NULL`
2. **新增** `packages/brain/src/__tests__/select-next-claimed-filter.test.js`：断言 SELECT SQL 字符串含 `claimed_by IS NULL`

## 不在本 PR 范围

- **不**改 claim 逻辑本身（C1 已完成）
- **不**改 dispatch 其他阶段（pre-flight / pool / cooling）
- **不**做 Engine version bump（仅改 Brain 源码）

## 成功标准

- `selectNextDispatchableTask` 的 SQL 在新 claimed 状态下不再返回任务
- 测试用例断言 SQL 字符串含 `claimed_by IS NULL`
- 现有 tick / dispatch 测试全部仍旧通过

## 影响文件

- `packages/brain/src/tick.js`（1 行新增）
- `packages/brain/src/__tests__/select-next-claimed-filter.test.js`（新建）
- `DoD.cp-04180903-claim-filter.md` / `docs/learnings/cp-04180903-claim-filter.md`
