# Learning: selectNextDispatchableTask 漏掉 claimed_by 过滤

## 发生了什么

PR #2389（C1）给 `tasks` 表加了 `claimed_by` / `claimed_at` 列 + 原子 UPDATE claim 逻辑，防止多 runner 并行 dispatch 同一任务。

但 `selectNextDispatchableTask` 的 SELECT WHERE 没同步补 `claimed_by IS NULL` 过滤：

- 已被 A runner claim 的任务，B runner 的 tick 仍会把它 select 出来走 pre-flight，最后原子 UPDATE 冲突才返回 409 —— 浪费一轮
- 更严重：claim 过但 release 失败的任务（`claimed_by` 残留），**永远**不会再被后续 tick 正确选中，任务卡死

本 PR 仅一行 SQL 补丁：`AND t.claimed_by IS NULL`。

## 根本原因

并发控制加列时，SELECT 侧与 UPDATE 侧（claim）未同步。单元测试只 mock `pool.query` 不跑真 SQL，所以没能自动捕获该 gap。

## 下次预防

加并发列（claim/lock/lease）时，必须三处同步：
- [ ] SELECT 候选 WHERE 里过滤掉已占用行（如 `claimed_by IS NULL`）
- [ ] UPDATE 原子 claim 的 WHERE 含预期旧值（CAS 语义）
- [ ] 单测断言 SELECT SQL 字符串含该过滤子句（不依赖真 DB）
