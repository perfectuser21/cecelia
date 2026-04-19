## Stop Hook 多 Worktree Session 路由根治（16.0.0 → 17.0.0）（2026-04-19）

### 根本原因

empirical 定位（Phase 6 E2E 重测 MARKER2.md 任务，claude -p 完整跑 /dev 7 棒接力 + PR 创建，但 PR 永不自动合并）：

1. `hooks/stop.sh` 扫 git worktree list 找**第一个** `.dev-lock` 就 `break 2` route 到 stop-dev.sh，不区分 session。并行多 /dev 会话时（例如 `ci-harden-batch1` + `phase6-e2e-marker2`）总是处理第一个被扫到的 → 错 session 的 devloop-check 判断 → exit 0 放行 → PR 永不自动合并
2. 更深层：stop-dev.sh `_session_matches` 用 `$CLAUDE_SESSION_ID` env var 做 session 匹配，**但 Claude Code 不传这个 env var**（env-probe 实测 2.1.114：Claude Code 只通过 **stdin JSON** 传 `session_id`/`transcript_path`/`cwd`/`stop_hook_active`）→ session 分支永远失败 → 退到 branch/tty 分支也失败（headless tty=not a tty，cwd=main repo 不是 worktree）→ stop-dev.sh 找不到匹配 → exit 0 放行

之前 PR #2373（跨 session orphan 不对称修复）、#1189/#1190（stop hook worktree 扫描）反复修相关 session 匹配，但都没触及根因：**env var 就是空的，匹配设计本身是错的**。

### 下次预防

- [ ] Claude Code hook 的 session_id / transcript_path / cwd 等元数据**只能通过 stdin JSON 读**，不能从 env var 读（env-probe 实测证实 2.1.114 不传）
- [ ] 多 worktree 并行场景必做 regression test：模拟 N 个 .dev-lock 不同 owner_session，验证路由精确匹配
- [ ] 任何 "session" 相关匹配代码，必须先 empirical 验证 "session id 真实来源是什么"，不要假设 env var 有
- [ ] bash 进程链里拿 claude session-id 的方法：沿 `$PPID` 向上 `ps -o args=` 找 claude 进程 cmdline 解析 `--session-id`（适用于 headless 启动时显式指定 session-id 的场景）
- [ ] 测试 vitest spawn stdin 不可靠，用 env var 作为 test 逃生（CLAUDE_HOOK_STDIN_JSON_OVERRIDE），生产依然从 stdin 读
- [ ] 每个修 hook 的 PR 必须跑真实"多 worktree 并行"场景验证，不要只跑单 worktree

### 相关 PR

- #2373 / #1189 / #1190: 之前反复修相关 session 匹配但没触及根因
- 本 PR（17.0.0）: 根治 — stop.sh 从 stdin 读 session_id + 按 owner_session 精确路由 + worktree-manage 沿 PPID 链写正确 owner_session
