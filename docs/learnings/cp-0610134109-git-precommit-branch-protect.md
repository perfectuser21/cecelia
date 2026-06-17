## 全局 git pre-commit hook 分支保护（2026-06-10）

### 根本原因
branch-protect.sh 只注册为 Claude Code 的 PreToolUse hook（针对 Write/Edit 工具），Python/Bash 直接文件写入完全绕过。导致之前一次 session 里用 Python 修改了 skill 文件，本地与 GitHub 不同步。

### 下次预防
- [ ] git commit 层有 pre-commit hook 保护：cp-* 分支 + .dev-mode 文件缺一不可
- [ ] 覆盖所有写入方式（Python/Bash/vim/任何工具），无法绕过
- [ ] PR 合并后、worktree 清理后需重新运行 `bash scripts/install-global-hooks.sh` 更新 symlink 到主仓库稳定路径
- [ ] ~/.claude/hooks/*.sh 已 chmod 555，防止 Claude Code 工具层篡改 hook 本身
