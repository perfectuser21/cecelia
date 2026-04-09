# Task Card: Stop Hook 会话隔离修复

**Task ID**: 81cce048-e2bd-401a-9027-dbf42ead2074  
**Branch**: cp-04092219-fix-stop-hook-session  
**Priority**: P1

## 目标

修复 Stop Hook 会话隔离 Bug：`.dev-lock` 文件因缺少 `tty`/`session_id` 字段，导致 `_session_matches()` 无法识别当前会话，Stop Hook 错误返回 `exit 0` 允许 Claude 退出。

## 根因

`worktree-manage.sh` 在创建 worktree 后没有写入 `.dev-lock.BRANCH` 文件。Step 0 指令靠 Claude agent 手动创建，但可能创建空文件（`touch`），导致：
- `lock_tty` 为空 → tty 匹配失败  
- `lock_session` 为空 → session_id 匹配失败  
- `lock_branch` = `cp-XXXXX` 但 `cur_branch` = `main`（agent 在主仓库运行）→ 分支匹配失败  
- → `_session_matches()` 返回 false → 找不到 DEV_LOCK_FILE → `exit 0`

## 改动范围

### F1: worktree-manage.sh — 自动创建 .dev-lock（v1.4.0）
- `cmd_create()` 在 `git worktree add` 成功后立即写入 `.dev-lock.BRANCH` 到主仓库根目录
- 内容包含：`branch`、`session_id`（含 `$CLAUDE_SESSION_ID`）、`tty`（`$(tty)`）、`worktree_path`、`created`

## 成功标准

- `worktree-manage.sh create` 执行后，主仓库中出现 `.dev-lock.BRANCH` 文件且含有 tty 字段
- Stop Hook 能正确识别该会话，不再误返回 `exit 0`
