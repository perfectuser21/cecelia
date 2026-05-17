# Learning — W7.3 Bug #E: startup-recovery 误清活跃 worktree

## 实证

5/6 21:00 左右运行的 4 个 cp-* harness agent worktree（每个含活跃 .dev-lock + .dev-mode.cp-*），
在 Brain 重启后全部消失。重建 worktree 时确认目录已被
`cleanupStaleWorktrees -> rmSync(..., {recursive:true, force:true})` 删除。

## 复现路径

1. agent 在 `WORKTREE_BASE/agent-XXX` 下创建 worktree + 写 `.dev-lock` + `.dev-mode.<branch>`
2. 由于 worktree 路径不在主 repo 的 `git worktree list --porcelain` 输出里（worktree
   元数据漂移、git checkpoint 异常等），cleanupStaleWorktrees 把它当作"孤立目录"
3. `rmSync(fullPath, {recursive:true, force:true})` 一次性把整个工作树连同 .dev-lock /
   .dev-mode 都炸掉，agent 状态全丢

## 根本原因

cleanupStaleWorktrees 只用一个信号（`git worktree list` 是否包含路径）来判断是否清理，
**没有 fallback 防线**。git list 信号一旦出错（prune 失败、metadata 不一致、worktree
被 detach 等），就直接误删活跃工作。

更深层：清理策略的"破坏性"和"判定信号的强度"不成正比 —— 删除是不可逆操作，应该
要求**多个独立信号都指向 stale** 才动手。

## 修复

`hasActiveDevLock(worktreePath)` 作为第二防线，命中即跳过：

1. `<worktreePath>/.dev-lock` 文件 mtime 在 24h 内 → 活跃
2. `<worktreePath>/.dev-mode` 或 `.dev-mode.<branch>` mtime 在 24h 内 → 活跃

24h 窗口设计动机：足够覆盖一次正常 /dev 流程（包含 CI 等待），超出则视为残留可清理。
新增 `stats.skipped_active_lock` 计数让运维可观测。

## 下次预防

- [ ] 凡是 `rmSync(..., {recursive:true, force:true})` 删除可能含用户数据的目录，必须
      要求 ≥2 个独立判定信号一致（git 元数据 + 文件系统标记）
- [ ] zombie-cleaner / cecelia-run cleanup trap 等其他清理路径同样需要 hasActiveDevLock
      防护（本 PR 不包含，留给后续）
- [ ] 任何"清理 worktree"操作前先 grep `.dev-lock`/`.dev-mode.*` 文件并打日志，留底
- [ ] 上线后观察 Brain 启动日志含 `skipped_active_lock=N` 字段，N>0 说明保护生效
