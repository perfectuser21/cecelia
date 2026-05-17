## CI Gate 彻底修复（2026-05-04）

### 根本原因

1. **harness-contract-lint 静默失效**：`ci-passed` job 在 `needs:` 列表中包含了 `harness-contract-lint`，但 `check()` 调用列表里漏掉了这一项。GitHub Actions 中 `needs:` 仅控制"等待"，不控制"结果传播"——只有在 `check()` 里显式读取 `${{ needs.X.result }}` 才能让 X 的失败影响 ci-passed。这种漏加导致 harness-contract-lint 失败时 CI 仍然绿灯。

2. **dod regex 覆盖不完整**：初版 regex 只匹配 `DoD.md`，未覆盖 `DoD.cp-*.md`（最常见的 harness DoD 文件格式），导致 dod-behavior-dynamic 和 harness-dod-integrity 在实际 harness PR 中仍被无条件跳过（dod=false），优化失效。Code review 阶段通过对比 cleanup-merged-artifacts.yml 的 regex 模式发现并修复了这个盲区。

### 下次预防

- [ ] 每次向 ci-passed `needs:` 列表添加新 job 时，**同步检查 `check()` 调用列表**是否已包含对应行，两个列表必须保持一致
- [ ] 写文件变更检测 regex 时，**先查 cleanup-merged-artifacts.yml** 的已有 pattern，对齐命名约定后再写，避免新旧模式不一致
- [ ] Code review 阶段必须覆盖**语义层**（regex/逻辑是否覆盖所有真实场景），不能只验证语法正确性
