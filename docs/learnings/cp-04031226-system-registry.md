## 模块化 system-registry（2026-04-03）

### 根本原因
旧 feature-registry.yml 是单体文件（779行），引用了已删除的 CI 层（L3/L4），且包含已不存在的代码路径（packages/engine/scripts/devgate/）。v14.0.0 CI 重设计后数据源失真。

### 下次预防
- [ ] 删除功能模块时同步清理 registry 中的引用（devgate 删除时未清理 feature-registry.yml）
- [ ] registry 文件的 code_path 和 test path 应有 CI lint 自动验证（下个任务：registry-lint）
- [ ] CI 重设计时应同步更新所有引用旧 CI 层名的配置文件

### Worktree Hook CWD 问题
- hooks/branch-protect.sh 和 hooks/bash-guard.sh 中 verify-step.sh 使用 `git rev-parse --abbrev-ref HEAD` 检测分支，但 hook 从主仓库 CWD 运行，导致 worktree 中的 .dev-mode step 标记被拒绝（检测到 main 分支）
- [ ] 修复 verify-step.sh 的分支检测：从 FILE_PATH 推导 worktree 目录，再 cd 进去获取正确分支
