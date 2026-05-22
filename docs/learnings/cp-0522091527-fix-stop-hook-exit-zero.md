## Stop Hook Exit-Zero 三处根因修复（2026-05-22）

### 根本原因

1. **ship-finalize.sh 过早杀 guardian**：engine-ship 在 PR 推送后调 ship-finalize，立即 SIGTERM guardian。Light 消失，stop hook 无法 block，PR 无人等 CI。

2. **executor.js 注入错误 CLAUDE_SESSION_ID**：`extraEnv.CLAUDE_SESSION_ID = task.id` 是 v19 .dev-lock 时代遗留代码，导致 worktree-manage.sh 用 Brain task UUID 命名 light，与 stop hook 实际扫描的 Claude session UUID 前缀不匹配 → all_dark → exit 0。

3. **stop-dev.sh 无 branch 兜底**：仅靠 session ID 前缀扫描，错位时直接 all_dark → exit 0。

### 下次预防

- [ ] engine-ship 类脚本修改时，检查是否有提前清理 guardian 的逻辑
- [ ] executor.js 注入 env var 时，确认不覆盖 worktree-manage.sh 的 session ID 解析
- [ ] stop hook 新增 REASON_CODE 时，思考"lights 为空"的兜底场景
