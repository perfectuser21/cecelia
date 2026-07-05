# Learning — session 隔离根治（launcher 自动 worktree + hook 硬拦主仓写）

## 背景

2026-07-05 上午多个交互 claude session 互踩数小时：cwd 全落在主仓工作树、共用同一 cp-* 分支和 `.dev-lock`，互相覆盖文件、踩 git 状态。

### 根本原因

1. **入口断链**：CLAUDE.md 推荐的 `alias claude=claude-launch.sh` 从未真正装上——`~/.zshrc` source 的 `claude-account-switch.sh` 定义了 `claude()` 函数直接 `command claude` 启动，完全绕过 launcher。交互 session 因此没有 `CLAUDE_SESSION_ID` export，owner_session 匹配失败。
2. **分支 ≠ 目录隔离**：git 分支只隔离代码历史，不隔离工作目录。多个 session 哪怕各想用不同分支，只要 cwd 是同一个主仓目录，就共享同一份文件和 git 状态。
3. **既有 hook 全部管不到这个场景**：`worktree-checkout-guard` 只拦"正在发生的 checkout 动作"，管不了"主仓已停在任务分支"的存量状态，也管不了"session 启动本身"（启动不经过任何 PreToolUse hook）。

### 修复

- `scripts/claude-launch.sh`：交互模式 + cwd=主仓工作树 → 自动建/复用 `session-<sid8>` worktree（base=origin/main），cd 进去再起 claude；干净退出自动清理，脏保留；headless/`CECELIA_NO_AUTO_WORKTREE=1`/已在 worktree 跳过。
- 新增 `packages/engine/hooks/main-repo-write-guard.sh`（PreToolUse backstop）：主仓工作树内 Write/Edit/`git commit`/`git add` → block。
- 判主仓统一判据：`git rev-parse --git-dir` == `--git-common-dir`（主仓相等，linked worktree 不等），launcher 与 hook 共用。

### 下次预防

- [ ] 任何"启动即生效"的防护必须放在 shell 启动层（launcher），不能只依赖 PreToolUse hook——hook 只能看到工具调用，看不到 session 启动。
- [ ] 推荐 alias/入口配置类的部署项，验收时必须实际 `zsh -ic 'type claude'` 验证生效路径，不能只写文档假设用户已配置。
- [ ] launcher 的 stdout 必须完整留给 claude 本体，git 辅助操作输出一律走 stderr/丢弃（本次踩坑：`git worktree add` 的提示信息混入 stdout 污染测试断言，生产同样会污染管道）。
- [ ] 改 launcher 时既有测试若真实执行（非 dry-run），要给它们显式设 `CECELIA_NO_AUTO_WORKTREE=1`，否则 CI 的主仓 checkout 会误触发真建 worktree。
