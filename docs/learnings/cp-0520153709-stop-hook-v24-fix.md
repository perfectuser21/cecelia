# Learning：Stop Hook v24 — session_id env var + 灯亮 classify_session + guardian cleanup

## 根本原因

### Bug 1：session_id 传递断链

stop.sh v17 起在 hook 入口用 `cat` 消费了整个 stdin 管道（导出 CLAUDE_HOOK_SESSION_ID）。
stop-dev.sh 之后再读 stdin → EOF → session_id 始终为空。
非 pipe 模式下走 `tty_no_session_id` 分支 → DECISION=release → stop hook 永远放行。
日志证据：`~/.claude/hook-logs/stop-dev.jsonl` 100% 显示 `tty_no_session_id`。

### Bug 2：guardian 永不退出

guardian 以 `ORPHAN_MODE=1 nohup disown` 启动（合理，避免 worktree-manage.sh 退出误杀 guardian）。
但 engine-ship / cleanup.sh 没有 SIGTERM guardian 的逻辑。
修好 Bug 1 后 guardian 永远跑 → 灯永不灭 → classify_session=blocked 永远持续 → 永远 block。

## 修复方案

1. **stop-dev.sh v24**：用 `CLAUDE_HOOK_SESSION_ID` env var（stop.sh 已 export），不重读 stdin
2. **灯亮时调 classify_session(cwd)**：获取具体状态（blocked/done/not-dev）+ action，透传给 Claude
   - blocked → BLOCK_REASON 含具体 action（Claude 知道下一步做什么）
   - done → kill guardian + rm 灯文件（v24 第一道保险）
   - not-dev/error → 放行（保守，不误 block）
3. **cleanup.sh**：done 时读 .live 文件 guardian_pid → SIGTERM + rm 灯文件（第一道防线）

## 下次预防

- [x] stop.sh 和 stop-dev.sh 共用数据通路：stop.sh 消费 stdin 后必须 export 关键字段（已 export CLAUDE_HOOK_SESSION_ID + CLAUDE_HOOK_CWD）
- [x] stop-dev.sh 不能读 stdin（stop.sh 已消费），统一用 env var
- [x] guardian 生命周期必须在 cleanup.sh done 时显式 SIGTERM（不能依赖 ORPHAN_MODE 自然死亡）
- [ ] 任何 stop hook 改动必须附 T1-T16 全部测试通过证明
- [ ] hook-logs/stop-dev.jsonl 是 hook 健康度一手数据，改动后必查 reason_code 分布
- [ ] stop.sh → stop-dev.sh 数据协议变更（新增/删除 env var 传递）必须在设计文档标注
