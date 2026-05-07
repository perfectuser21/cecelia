# Learning: harness-worktree 初始化必须校验 origin remote，否则孤儿 dir 让 docker exit 125

## 时间
2026-05-07 18:46 (Asia/Shanghai)

## 现场
W7.3 cleanupStaleWorktrees 误清活跃 worktree（P0-C），Brain 重 spawn 同 task 时
`ensureHarnessWorktree` 仅靠 `git rev-parse --is-inside-work-tree=true` 判定可复用，
误把孤儿 dir（独立 git repo，不是 baseRepo 的 clone）当成合法 worktree 复用，
docker-executor 起容器后 27ms 内 exit 125。
实证：W8 task-39d535f3 today docker exit 125 in 12-28ms。

## 根本原因

`git rev-parse --is-inside-work-tree` 只判断"是否 git repo 内部"，
对**任意**带 `.git` 目录的 dir 都返回 `true`。
W7.3 cleanup race 后留下的 dir 里残留独立 git repo（缺 origin remote、缺 main 分支），
仍能通过这道检查 → 复用 → docker mount 即崩。

旧逻辑只在 rev-parse **抛错**才走重建路径，对孤儿 repo 完全无感。

## 下次预防

ensureHarnessWorktree 复用前必须串联两道校验：
1. `git rev-parse --is-inside-work-tree` 是 git repo
2. `git remote get-url origin` 输出包含 baseRepo 路径
任一失败 → `rm -rf dir` + 重新 `git clone --local --no-hardlinks baseRepo`。

通用法则：**判断 dir 能否复用，不能只看"是不是 git repo"，还要看"是不是我要的那个 git repo"。** 对任何挂载到下游容器/进程的目录复用决策，都要校验源关系（remote、submodule parent path 等），不能只校验本地结构。

- [ ] 巡检：grep `rev-parse --is-inside-work-tree` 找其他 worktree 复用点是否同样缺少 remote 校验
- [ ] 巡检：W7.3 cleanupStaleWorktrees race 本身（P0-C）的修复进度
- [ ] 监控：harness-v2 spawn 失败时记 worktree 状态快照（origin + branch + .git type）
