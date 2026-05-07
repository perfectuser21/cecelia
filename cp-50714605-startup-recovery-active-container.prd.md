# PRD: startup-recovery 加 docker container 活跃性保护（W7.3 升级）

## 背景

W7.3 PR #2812 在 `cleanupStaleWorktrees` 加了 `.dev-lock` / `.dev-mode.*` 24h mtime 窗口保护，但**没保护到 docker container 层活跃的 worktree**。

## 实证 Bug（2026-05-07）

W8 task-39d535f3 跑到 reviewer 阶段时，Brain 重启 → `git worktree list --porcelain` 没列出 `harness-v2/task-39d535f3`（race：harness pipeline 跑中时 git 层可能已 prune 元数据），但该目录正被 `cecelia-task-39d535f3` 容器以 `-v` mount 使用 → `rm -rf` → 任务无法继续。

## 问题根因

`cleanupStaleWorktrees` 删 worktree dir 前活跃性判定只看：
1. `git worktree list --porcelain`（race 不可靠）
2. `.dev-lock` / `.dev-mode.*` 文件 mtime（harness 容器不一定写这些）

缺 docker container 维度。

## 成功标准

- [BEHAVIOR] 活跃 docker container（cecelia-task-* / harness-* 等）mount 的 worktree 路径不被 cleanup
- [BEHAVIOR] docker ps 调用失败（docker daemon 未启 / 命令缺失）时**保守跳过删除**，不抛错，记 warn
- [BEHAVIOR] docker ps 返回空 / mount 路径不匹配 → 仍按既有逻辑删除（不破坏现 cleanup 能力）
- [ARTIFACT] `startup-recovery.js` 含 `docker ps` 调用代码

## 实施要点

`packages/brain/src/startup-recovery.js`:

1. 新增 `getActiveContainerMountPaths()` 函数（导出方便测试）：
   - 调 `docker ps --format '{{.ID}}'` 拿活跃 container ID 列表
   - 对每个 container 调 `docker inspect --format '{{json .Mounts}}' <id>`
   - 解析 `Source` 字段，返回 `Set<string>`（所有 mount source path）
   - 任一 docker 命令抛错 → 整个函数抛 `Error`（caller 决定如何降级）

2. `cleanupStaleWorktrees` 改造：
   - 在循环删 stale dir 前一次性调用 `getActiveContainerMountPaths()`
   - 调用抛错 → 设 `dockerProbeFailed = true`，记 warn
   - 决策（每个 stale dir）：
     - 若 `dockerProbeFailed` → **跳过删除**（保守），stats.skipped_docker_probe++
     - 若 worktree dir 路径是某 mount source 的前缀（mount source startsWith worktree dir + '/' 或等于 worktree dir）→ 跳过，stats.skipped_active_container++，log: `[StartupRecovery] skipped active container worktree: <path> (container: <id>)`
     - 否则继续走 `hasActiveDevLock` → rm

## 不做

- 不改 prune / withLock / cleanupStaleLockSlots / cleanupStaleDevModeFiles
- 不持续轮询 docker（只在 startup recovery 一次性调）
