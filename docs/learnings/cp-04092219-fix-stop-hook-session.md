# Learning: Stop Hook 会话隔离 — worktree-manage.sh 自动写入 .dev-lock

**Branch**: cp-04092219-fix-stop-hook-session  
**Date**: 2026-04-09

### 根本原因

Stop Hook 通过 `_session_matches()` 识别当前会话，匹配逻辑按优先级：
1. TTY 匹配（`lock_tty == cur_tty`，都是 /dev/tty*）
2. session_id 匹配（`CLAUDE_SESSION_ID`）
3. 分支匹配（fallback，仅当 tty/session 都缺失时使用）

根因：`worktree-manage.sh` 未创建 `.dev-lock.BRANCH`，依赖 Step 0 的 Claude agent 手动创建。agent 可能创建空文件（touch），导致三种匹配方式全部失败：
- tty 为空 → 失败
- session_id 为空 → 失败  
- branch 分支 = cp-XXXXX，但 agent 在主仓库（main 分支）→ 失败
- → 找不到 DEV_LOCK_FILE → exit 0 → Claude 错误退出

### 修复方案

在 `cmd_create()` 的 `git worktree add` 成功后，立即写入 `.dev-lock.BRANCH` 到主仓库根目录，内容包含：
- `tty: $(tty 2>/dev/null || echo "none")`
- `session_id: ${CLAUDE_SESSION_ID:-headed-$$-${branch_name}}`
- `branch: ${branch_name}`
- `worktree_path: ${worktree_path}`

写入放在主仓库（`$main_wt`），因为 Stop Hook 的 `_collect_search_dirs` 优先扫描主仓库。

### 下次预防

- [ ] worktree 创建脚本必须负责 .dev-lock 写入，不依赖 agent 手动执行
- [ ] Step 0 的手动创建指令可以保留作为覆盖层，但 worktree-manage.sh 是兜底保障
- [ ] 如果 tty 是 "not a tty"（headless 模式），`CLAUDE_SESSION_ID` 是唯一可靠标识符
