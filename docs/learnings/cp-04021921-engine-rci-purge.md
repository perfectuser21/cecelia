# Learning: regression-contract.yaml 腐烂条目清理

**日期**: 2026-04-02
**分支**: cp-04021915-engine-rci-purge

## 背景

regression-contract.yaml 183 条中 26 条引用了已删除的文件/测试，占 14%。
这些条目来自之前多轮清理中被删的脚本（lock-utils.sh/pipeline-trace.sh/worktree-gc.sh 等）。

### 根本原因

删除脚本/测试文件时没有同步清理 regression-contract.yaml 中的对应条目。
RCI 文件太长（3745 行），人工很难察觉遗漏。

### 下次预防

- [ ] 每次删除 packages/engine/ 下的文件后，用脚本自动检查 regression-contract.yaml 中是否有引用
- [ ] 可考虑在 CI L2 加一个 rci-stale-ref 检查：扫描所有 file/test 字段，验证文件存在
