# T3 cecelia-run.sh docker trap 修 Learning

## 做了什么
改 `packages/brain/scripts/cecelia-run.sh` cleanup() trap（L408-418）：加 `[[ -f /.dockerenv ]]` 判定，docker 模式改写 flag 文件 `/tmp/cecelia-worktree-cleanup-flags/<basename>.flag`；host 模式保留原 `git worktree remove --force` 逻辑。加 `test-cecelia-run-docker-trap.sh` 3 case bash 测试。

## 根本原因
cecelia-run 在 Brain docker 容器内跑（harness dispatch 场景）时，容器内 .git 无 worktree metadata → `git worktree remove` 必 fail。导致 exit trap 清理失败，host 侧 worktree 留残。靠 zombie-cleaner/sweep 兜底（延迟 + 浪费 tick）。

## 下次预防
- [ ] docker 容器内 bash 脚本涉及 host 端状态（git worktree / .dev-mode / /tmp/host-locks 等）时，必须 `[[ -f /.dockerenv ]]` 条件分支
- [ ] 用 `/.dockerenv` 内建检测优于 env var（无需改 Dockerfile/entrypoint）
- [ ] 跨进程/容器清理用"写 flag 让另一端消费"的 pattern 比直接操作更 robust

## 关键决策
**不立即实施 host 侧 flag 消费**：zombie-cleaner/sweep 两层 safety net 已能兜底清 orphan worktree（#2572/#2574 已修文件名不匹配 + 双通道），24h 观察 flag 文件堆积情况再决定是否加专门 consumer。YAGNI。
