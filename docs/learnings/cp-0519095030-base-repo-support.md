## harness pipeline 支持外部 repo（base_repo payload）（2026-05-19）

### 根本原因

`harness-initiative.graph.js` 的两处 `ensureHarnessWorktree` 调用从未传 `baseRepo`，
导致 harness pipeline 硬绑定到 Cecelia 仓库。虽然 `harness-worktree.js` 早已支持
`opts.baseRepo` 参数，调用方一直没传入——典型的"功能存在但入口缺失"盲区。

### 下次预防

- [ ] 新增 harness 参数时，同步检查所有调用方是否需要透传
- [ ] 涉及路径/仓库的参数，第一次实现就应加集成测试覆盖透传路径
- [ ] `DEFAULT_BASE_REPO` 这类常量出现时，考虑是否需要 payload override 机制
