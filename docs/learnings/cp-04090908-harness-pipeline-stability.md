# Learning: Harness Pipeline 稳定性修复 — 3 个 Bug

## 背景

E2E v4 测试运行后暴露了三个阻塞 harness pipeline 自主运行的 Bug。

## 根本原因

### Bug 1: harness-watcher.js SQL 类型推断
PostgreSQL 无法在 `jsonb_build_object()` 内从 JS string 参数推断 `$2`/`$3` 的类型，报 "could not determine data type of parameter $2"。CI 失败路径 watcher crash，导致 `harness_fix` 任务永远不会创建。

**修复**: `$2::text`、`$3::int` 显式类型转换。

### Bug 2: tick.js 超时重入队触发熔断器
任务超时重入队（`auto-requeue-timeout`）后调用了 `recordFailure('cecelia-run')`，将任务超时误计为执行器故障。熔断阈值 3 次即 OPEN 5 分钟，导致整个 pipeline dispatch 停止。任务本身没问题，是执行器拿到了超过 timeout 的任务。

**修复**: 从超时重入队路径移除 `recordFailure`。

### Bug 3: account-usage-scheduling 测试状态泄漏
`account-usage.js` 中 `_spendingCapMap` 是模块级 `Map`，跨测试用例保持状态。H1 调用 `markSpendingCap('account2', +2h)` 后，H2/H3 继承了该状态，account2 仍被 cap，选账号结果与预期不符。

**修复**: H2/H3 在调用 `selectBestAccount` 前先用过期时间清除 account2 的 spending cap。

## 下次预防

- [ ] 编写 `jsonb_build_object` 有参数化值时，始终显式标注 `::text`/`::int` 类型
- [ ] 熔断器 `recordFailure` 调用处需明确：只在执行器自身故障（进程崩溃/API 错误）时调用，任务超时/重入队不计入
- [ ] 测试中修改模块级状态的用例（spending cap、auth cache）须在 `afterEach` 或下一个 `it` 开头显式清理
