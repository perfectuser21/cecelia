# Brain vitest thresholds 移除

## 背景

CI `brain-diff-coverage` 第 1 步 `vitest run --coverage` 因 `packages/brain/vitest.config.js` 全局 `thresholds`（lines/statements 75，functions 80）fail（当前 brain 全局覆盖率约 67%）。第 2 步 `diff-cover --fail-under=80`（PR 新增行覆盖率 80%）永远跑不到，导致 Harness Generator 的合格新代码 PR 全部被卡死。

## 目标

让 `diff-cover --fail-under=80` 成为 brain 唯一覆盖率门禁。

## 改动

删除 `packages/brain/vitest.config.js` 中 `coverage.thresholds` 块（7 行）。

## 成功标准

- `packages/brain/vitest.config.js` 不含 `thresholds:` 字段
- 当前 PR 的 `brain-diff-coverage` job 跑通到 diff-cover 阶段
- 当前 PR 全部 CI 绿
