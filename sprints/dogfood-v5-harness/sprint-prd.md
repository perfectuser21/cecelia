# Sprint PRD — Retry 工具（Harness v5.0 Dogfood 验证）

**状态**: 仅用于验证 Harness v5.0 Proposer/Reviewer 行为，不真实实施

## 功能

为 `packages/brain/src/retry.js` 新增 `fetchWithRetry(op)` 函数：

1. 调用 `op()`，如失败自动重试
2. 最多重试 3 次（共 4 次调用）
3. 指数退避：每次重试间隔至少是上次的 1.5 倍（基准 100ms）
4. 超过 3 次后抛出最后一次的异常

## 成功标准

- `fetchWithRetry` 函数从 `packages/brain/src/retry.js` 被导出
- 3 次瞬时失败后第 4 次成功，函数能返回最终结果
- 每次重试间隔满足指数退避（`gap[i+1] >= gap[i] * 1.5`）
- 超过 3 次后抛出原始异常（使用 `.rejects.toThrow`）
- 模块导出常量 `MAX_RETRIES = 3`

## 预期 Workstream 拆分

单 workstream（S 任务 <100 行）。
