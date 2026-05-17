# Learning: R4 — 孤儿 worktree 自动清理 worker

### 根本原因

`Agent()` tool + `isolation: "worktree"` spawn 的 sub-agent 跑完 /dev（push + 开 PR + auto-merge）就直接退出进程。
标准 /dev 的 Stop Hook（`stop-dev.sh`）在 session 结束时触发，调 `cleanup.sh` 清理 worktree + branch。
但 Agent 模式**不触发** Stop Hook——因为 Stop Hook 绑定的是主 Claude Code session 的 stop，sub-agent 进程退出不走这条路径。

结果：PR merge 了，但 worktree 目录和本地 branch 都留在盘上。今天累积了 3 个：
- `agent-a6a30b0d` (R1 #2397)
- `agent-ac87b750` (memory-health #2396)
- `agent-af0765fb` (R2 #2398)

这些孤儿占盘、可能污染 `git worktree list` 和未来的 cleanup 逻辑。手动清理是一次性动作，不解决根本问题。

### 下次预防

- [ ] Brain tick 每 10 分钟调 `packages/brain/scripts/cleanup-merged-worktrees.sh`
- [ ] 脚本白名单只扫两条 glob（`.claude/worktrees/agent-*` + `~/worktrees/cecelia/*`），**不碰**其他 session 的 worktree
- [ ] 5 项安全守卫（uncommitted / unpushed / merged_at < 1h grace / 主干 branch / human_hold）任一不过即 skip + log reason
- [ ] 未来若新增其他 Agent spawn 模式，优先让它们落进白名单路径，保证能被这个 worker 清到
- [ ] `MINIMAL_MODE` 下跳过 cleanup-worker，避免影响快速重启场景

### 侧带发现

- `util.promisify(exec)` 在测试里 mock `child_process` 后会失效（需要 `util.promisify.custom` symbol）。手写 `new Promise + exec(cmd, opts, cb)` 更便于 mock，且与 node 原生 callback 一致。
- macOS BSD `date -u -j -f "%Y-%m-%dT%H:%M:%SZ"` 不接受 fractional seconds，需要先 `sed 's/\.[0-9]*Z/Z/'` 截断。
