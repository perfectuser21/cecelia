## CI DoD BEHAVIOR 命令从荣誉制改为硬检查（2026-04-07）

### 根本原因

DoD `[BEHAVIOR]` 条目的 `Test: manual:node ...` 命令从未被 CI 实际执行——CI 只检查格式（有没有 `[BEHAVIOR]` 标签、是否全部勾选 `[x]`），验证命令本身是荣誉制。这导致即使写了错误的验证命令，CI 也不会发现。

### 下次预防

- [ ] 写 `Test: manual:node -e "..."` 时，先在本地执行一遍确保命令正确
- [ ] `manual:node` 命令使用 `process.exit(1)` 而非 `throw`，确保 CI 能正确捕获失败
- [ ] 需要运行时服务的验证（curl/psql/chrome）改用 `[ARTIFACT]` + 文件存在检查替代，或接受跳过
