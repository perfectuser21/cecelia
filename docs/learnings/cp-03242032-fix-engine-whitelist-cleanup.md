# Learning: 清理重复 check-manual-cmd-whitelist.cjs

**分支**: cp-03242032-fix-engine-whitelist-cleanup
**日期**: 2026-03-24

### 根本原因

`scripts/devgate/check-manual-cmd-whitelist.cjs` 是一个从未被 git 追踪的游离文件，
存放在主仓库根目录下（`scripts/devgate/`），而正确位置是 `packages/engine/scripts/devgate/`。
verify-step.sh L133 的路径搜索逻辑已正确包含两个路径，但如果该游离文件存在且版本不一致，
可能导致 MODULE_NOT_FOUND 错误（路径搜索意外依赖了错误版本）。

修复：直接 `rm` 删除未追踪文件（无需 git 操作，因为从未被追踪）。
verify-step.sh 路径逻辑无需修改，已正确。

### 下次预防

- [ ] 不要在 `scripts/devgate/` 下手动放置 `.cjs` 文件，该目录只存放 devgate 入口脚本
- [ ] Engine DevGate 工具的正确位置是 `packages/engine/scripts/devgate/`
- [ ] 未追踪文件 (`git status` 中 `??` 的文件) 在 worktree 中不会出现，需要在主仓库手动删除
