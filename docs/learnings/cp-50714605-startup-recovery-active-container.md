# Learning: startup-recovery 加 docker container 活跃性保护（W7.3 升级）

## 背景

W7.3 PR #2812 在 `cleanupStaleWorktrees` 加了 `.dev-lock` / `.dev-mode.*` 24h mtime 窗口保护，解决了 5/6 误清 4 个 cp-* worktree 的事故。但 2026-05-07 又出了同类事故：W8 task-39d535f3 跑到 reviewer 阶段时 Brain 重启 → harness-v2/task-39d535f3 整个被 rm -rf。

### 根本原因

`cleanupStaleWorktrees` 删 worktree dir 前的活跃性判定漏了 docker container 维度：

1. `git worktree list --porcelain` 在 harness pipeline 跑中时存在 race（git 层可能已 prune 元数据，但 docker 容器还在用 worktree）→ 该路径被判为不活跃
2. `.dev-lock` / `.dev-mode.*` 时间窗保护是 W7.3 的修复，但 **harness 容器不写 `.dev-lock`** —— harness pipeline 用 `cecelia-task-XXX` docker container 直接 mount worktree dir，跳过 dev-lock 流程
3. 两道防线都漏了 → `rm -rf` 整个目录

### 下次预防

- [x] `cleanupStaleWorktrees` 删任何 worktree dir 前必须先 probe `docker ps` + `docker inspect`，得到所有活跃 container 的 mount source 集合，命中（mount source 等于或落在 worktree 路径内）→ 跳过删除，记日志 `[StartupRecovery] skipped active container worktree: <path> (mount: <src>)`
- [x] `docker ps` 命令本身失败（docker daemon 未启 / 命令缺失）→ **保守降级**：所有 stale dir 跳过删除（不抛错，记 warn）。宁可漏清也不再误删活跃 worktree
- [x] 单 container `docker inspect` 失败容忍（race：container ps 后立即退出），不影响整体 probe
- [x] 单元测试覆盖：活跃 container 命中 / docker probe 失败降级 / 空返回仍删 orphan / mount 不重叠仍删 orphan / `getActiveContainerMountPaths` 直接测试

### 设计原则

启动时 cleanup 是高危操作，活跃性判定必须**多维度合取**：
- git 层（worktree list）—— 弱信号，有 race
- 文件层（.dev-lock 时间窗）—— 中信号，依赖客户端写入
- 容器层（docker ps mount）—— 强信号，docker daemon 是事实唯一源

任一信号判活跃 → 跳过。任一信号探测失败 → 保守跳过（不是冒进删除）。

### 关联

- 上游修复：PR #2812 (W7.3 .dev-lock 时间窗保护)
- 本次升级：补 docker container 维度保护
- Harness pipeline 容器：`cecelia-task-*` / `harness-*`
