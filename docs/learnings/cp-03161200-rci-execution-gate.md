---
id: learning-cp-03161200-rci-execution-gate
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: RCI Execution Gate

## 背景

实现 CI 实际执行 `packages/quality/contracts/cecelia-quality.regression-contract.yaml` 中 P0 条目的 `test_command`，并集成到 `ci-l1-process.yml` 的 `dod-check` job。

## 关键决策

### test_command 执行目录

cecelia-quality 合约中的 `test_command` 格式为 `bash tests/test-db-init.sh`，其中 `tests/` 是相对路径。这些测试文件位于 `packages/quality/tests/`，所以脚本必须在 `packages/quality/` 目录下执行测试命令，而非仓库根目录。

### DEFERRED 而非 FAIL 策略

P0 合约中的 4 个测试文件中，有 3 个需要启动运行时服务（Node.js 服务器、gateway 进程等），无法在 CI 静态环境中运行。采用 DEFERRED 策略：
- 检测到运行时依赖（`gateway-http.js`、curl localhost、后台进程 `&`）→ DEFERRED
- test_file 不存在 → DEFERRED
- 只有实际运行并失败才是 FAIL

这样既保证了可运行测试的实际验证，又不会因为 CI 环境限制造成误报。

### 根本原因（历史问题）

### 根本原因

RCI 合约自 2026-01-27 就存在，但从未有机制实际执行 `test_command`。合约只作为文档存在，没有实际约束力。开发人员可能修改代码破坏 P0 功能而不被 CI 发现。

### 下次预防

- [ ] 新增 RCI 条目时，同步评估该 `test_command` 是否可在 CI 无运行时环境中执行
- [ ] 如果测试需要运行时服务，在合约中标记 `runtime_required: true`，脚本可直接读取而无需启发式检测
- [ ] 考虑为可运行的 P0 测试（如 `test-db-init.sh` 只需要 sqlite3）提供 CI 可执行的精简版本
- [ ] `rci-execution-gate.sh` 的 requires_runtime 检测基于字符串模式，未来如果 test_command 格式变化需要更新检测逻辑

## 陷阱总结

1. **worktree 分支日期限制**：branch-protect.sh 会检测分支日期，超过 2 天会触发警告。但本 worktree 已在该分支上工作，所以只是警告而非硬失败（在 worktree 中操作正常）。

2. **主仓库分支冲突**：在 worktree 中创建分支前，如果主仓库已有同名分支且已 checkout，git 会报 `already checked out` 错误。需要先在主仓库切换分支后再在 worktree 创建。

3. **generate-path-views.sh 必须运行**：修改 `feature-registry.yml` 后必须运行此脚本，否则 CI 中的 path views 会不一致。
