# Learning: 重构 buildRetryContext（复杂度 22 → ~4）

**Branch**: cp-04030400-f4a39456-239f-4bd4-b306-e8b504
**Task**: f4a39456-239f-4bd4-b306-e8b504810e0e

### 根本原因

`buildRetryContext` 函数将失败分类解析、反馈解析、字符串拼接和截断逻辑都混在一个函数里，导致圈复杂度高达 22（阈值 10）。

### 重构策略

将 3 类职责提取为独立子函数：

1. `_retryFailureBlock(classification, watchdogKill)` — 只处理失败分类逻辑
2. `_retryFeedbackBlock(feedback)` — 只处理反馈解析逻辑
3. `_assembleRetryContext(failureCount, body)` — 只处理拼接与截断

主函数 `buildRetryContext` 降至复杂度 ~4（2 个早返回 + filter + 1 个函数调用）。

### 下次预防

- [ ] 新建函数前先估算复杂度：超过 4 个条件分支就考虑提取子函数
- [ ] 命名约定：模块内部辅助函数以 `_` 前缀标识（`_retryXxx`）
- [ ] worktree 没有 node_modules 时，在主仓库跑测试：`cd /Users/administrator/perfect21/cecelia && npx vitest run <test-file>`
