# PRD — session 隔离根治（launcher 自动 worktree + hook 硬拦主仓写）

## 背景

多个交互 claude session 的 cwd 全部落在主仓工作树、共用同一 `cp-*` 分支和 `.dev-lock`，
2026-07-05 上午互相踩踏数小时（改文件冲突、git 状态互踩、抢 docker/DB）。
`claude-launch.sh` 只保证 `--session-id`，完全不隔离工作目录；new branch 只隔离代码历史不隔离 cwd。

## 目标

交互 claude 从主仓启动时自动落进独立 per-session worktree，互不可见；
即便手动 cd 回主仓，PreToolUse hook 也硬拦写操作。

## 需求

1. `claude-launch.sh` 交互模式 + cwd=主仓工作树 → 自动建/复用 `session-<sid8>` worktree（base=origin/main），cd 进去再起 claude。
2. headless（`-p`）、已在 worktree、`CECELIA_NO_AUTO_WORKTREE=1` → 不触发，行为不变。
3. session 干净退出（无未提交改动/stash/未推送 commit）→ 自动清理该 worktree；脏的保留。
4. 新增 `packages/engine/hooks/main-repo-write-guard.sh`：主仓工作树内 Write/Edit/`git commit`/`git add` → block；只读放行；worktree 内放行。
5. `--dry-run` 契约保留：只打印命令不产生副作用。

## 成功标准

- 主仓根 + 交互模式 `--dry-run` 输出含 worktree 建立步骤；headless/已在worktree/逃生阀场景不含。
- 真实执行：建立 session worktree 并 cd 进去；干净退出自动清理；有改动/未推送提交则保留；同 session_id 重复启动幂等复用。
- hook：主仓 Write/Edit/`git commit`/`git add` → block；只读、worktree 内 → 放行。
