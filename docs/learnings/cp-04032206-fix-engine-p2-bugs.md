# Learning: Engine P2 Bug 修复

## 分支
`cp-04032206-fix-engine-p2-bugs`

## 修复内容

### Bug 1 (P2): devloop-check.sh — jq 无错误处理
- **根本原因**: `jq -r '.[0].status // "unknown"'` 无 `2>/dev/null`，`gh run list` 返回非 JSON 时 jq 报错到 stderr 并退出非零，变量被设为空字符串，触发 `*` 分支误报"CI 状态未知"
- **修复**: 加 `2>/dev/null || echo "fallback"`

### Bug 2 (P2): stop.sh — curl 后台进程缺 disown
- **根本原因**: `curl ... &` 启动后 shell 收到 SIGHUP（如 Claude Code 进程组退出）会向子进程传播，可能在 10 秒超时前杀死 curl，Brain 会话结束通知丢失
- **修复**: `disown $! 2>/dev/null || true`

## 多 agent 审计经验汇总（本次共 3 次修复迭代）

本次深度审计共 4 个 agent 并行扫描，得到约 40 个疑似 bug，经逐行验证后：
- PR #1833（前一次）：3 个真实 P0/P1
- PR #1840（本次 P0+P1）：4 个真实 bug，排除 16 个假报告
- PR #1842（本次 P2）：2 个真实 bug，排除 3 个假报告

**核心发现：agent 报告的"bug"约 60% 是假报告**，必须逐行验证才能确认。

## 下次预防

- [ ] 所有 `jq` 命令后加 `2>/dev/null || echo "default"` 防止 stderr 噪音
- [ ] fire-and-forget 后台命令统一模式：`cmd & disown $! 2>/dev/null || true`
- [ ] 多 agent 扫描结果需要一个验证步骤，不应直接进入修复
