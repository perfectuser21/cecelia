# Learning: brain-unit diff coverage gate

branch: cp-04101927-a4d5f807-e216-4d22-b3da-862bf8
date: 2026-04-11

### 根本原因

PRD 指定修改 `brain-ci.yml`，但实际仓库只有 `ci.yml`（统一 CI 入口）。`brain-unit` job 在 `ci.yml` 中。如果盲目按 PRD 创建 `brain-ci.yml`，会导致 gate 永远不运行。

### 关键决策

1. `@vitest/coverage-v8` 和 `coverage.reporter: ['lcov', ...]` 已在 `package.json` / `vitest.config.js` 中存在，无需重复添加。
2. diff-cover 仅在 `pull_request` 事件时运行（push to main 无 base_ref，跳过）。
3. `fetch-depth: 0` 是 diff-cover 正常工作的必要条件（需要完整 git history 来计算 diff）。
4. timeout-minutes 从 20 提升到 25（--coverage 会增加 vitest 运行时间）。

### 下次预防

- [ ] PRD 中的文件名与实际仓库不符时，先检查实际存在的 CI 文件再实现
- [ ] diff-cover 步骤必须配合 `fetch-depth: 0`，否则 `git diff` 无法找到 base
- [ ] 运行 `--coverage` 时注意 timeout 需要相应增加
