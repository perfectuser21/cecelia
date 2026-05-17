# Learning: Stop Hook Per-Worktree Mutex + Workflow 文档清理

**Branch**: cp-03221920-fix-stophook-mutex-cleanup
**Date**: 2026-03-22

## 修复内容

### 根本原因

**Mutex 共享问题**：`lock-utils.sh` 的 `_get_lock_paths()` 调用 `git rev-parse --git-dir` 时从 CWD 运行。Stop hook 的 CWD 永远是主仓库，所以无论哪个 worktree 触发 stop hook，`--git-dir` 都返回主仓库的 `/main/.git`，导致所有 worktree 共用同一个 `/main/.git/dev-mode.lock` — 互相阻塞。

**文档垃圾**：前几个版本中废弃的 squash-evidence.sh、post-pr-checklist.sh 脚本引用留在 skill 文档中；同步 review 改为 Agent subagent 后 "Codex 会独立再验一遍" 的旧说法未清理；03-integrate.md 6th file 指向 root package-lock.json 而非 CI 真正检查的 feature-registry.yml。

### 修复方案

- `lock-utils.sh` v1.3.0：`_get_lock_paths()` 先检查 `LOCK_UTILS_GIT_DIR` 环境变量；若设置则直接用，跳过 `git rev-parse --git-dir`
- `stop-dev.sh` v15.7.0：pre-check loop 匹配后保存 `_PRE_MATCHED_DIR`；mutex 获取前运行 `git -C "$_PRE_MATCHED_DIR" rev-parse --git-dir` 得到 per-worktree git-dir 并 export 为 `LOCK_UTILS_GIT_DIR`；fallback inline lock 也改用 `LOCK_UTILS_GIT_DIR`

### 下次预防

- [ ] 每次 worktree 相关修复后，验证 `LOCK_UTILS_GIT_DIR` 路径是否指向 worktree-specific 的 `.git/worktrees/<name>` 而非主仓库 `.git`
- [ ] 当一个 skill/script 被弃用时，同步搜索所有 skill 文档中对它的引用并清理
- [ ] 文档中 CI 检查文件列表要定期与实际 CI 脚本对齐（避免 feature-registry.yml vs package-lock.json 的错配）
