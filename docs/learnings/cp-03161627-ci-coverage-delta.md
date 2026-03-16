---
branch: cp-03161627-ci-coverage-delta
date: 2026-03-16
task: CI L3 新增 coverage-delta job — Brain feat PR 变更行覆盖率检查
---

# Learning: coverage-delta CI job

## 做了什么

在 `ci-l3-code.yml` 新增 `coverage-delta` job，对 Brain feat PR 的变更行进行覆盖率 delta 检查。
Engine 版本从 12.91.0 bump 到 12.92.0。

## 顺畅的地方

1. **Brain coverage 配置已就绪**：`vitest.config.js` 已配置 `json-summary` 格式输出到 `./coverage` 目录，`@vitest/coverage-v8` 已在 devDependencies，无需任何修改。
2. **Engine 版本 bump 流程清晰**：5 个文件同步，`check-version-sync.sh` 在 `packages/engine/` 目录下运行可快速验证。
3. **`[CONFIG]` 标签豁免机制**：CI 配置变更 PR 加 `[CONFIG]` 标签可绕过 `test-coverage-required` 检查，本次也适用。

## branch-protect Hook 要求 tasks_created: true（2026-03-16）

### 根本原因

branch-protect.sh 在写代码之前检查 .dev-mode 中是否有 `tasks_created: true`，确保 Task 已注册到系统。Step 1 创建 .dev-mode 时未包含此字段，导致第一次 Edit 文件被 Hook 拦截。

### 下次预防

- [ ] 在 Step 1 创建 .dev-mode 文件时，直接写入 `tasks_created: true`，不要等到 Hook 拦截才补

## check-version-sync.sh 必须在 packages/engine/ 目录下运行（2026-03-16）

### 根本原因

`packages/engine/ci/scripts/check-version-sync.sh` 用相对路径读取文件（`package.json`、`VERSION` 等），必须从 `packages/engine/` 目录运行。从 worktree 根目录运行时，pwd 下没有这些文件，导致检查逻辑异常。

### 下次预防

- [ ] Engine 版本检查始终用 `cd packages/engine && bash ci/scripts/check-version-sync.sh`

## 架构发现

`anuraag016/Jest-Coverage-Diff@main` Action 在 PR 上通过 GITHUB_TOKEN 发 comment，需要 `pull-requests: write` 权限。coverage-delta job 已正确配置此权限。

该 Action 会对比当前分支和 base 分支的 coverage-summary.json，计算 delta，若低于阈值则 fail。Brain 的 vitest `json-summary` 格式与 Istanbul/Jest 兼容，可直接使用。
