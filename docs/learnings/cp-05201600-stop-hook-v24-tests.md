## Stop Hook v24 完整 classify_session 实现（2026-05-20）

### 根本原因

**Bug 1（已在 #3061 修复）**：`stop-dev.sh` 重读 stdin 获取 `session_id`，但 `stop.sh` 已消耗 stdin → session_id 永远为空 → 走 `tty_no_session_id` → 永远放行。

**Bug 2（本 PR 修复）**：`classify_session(cwd)` 调用路径不完整：
- `#3061` 版本：灯亮时直接设 `DECISION=block`，仅取 `.action` 字段作 BLOCK_REASON（`.reason` 被忽略），且 `done`/`not-dev` 状态从未处理（永远 block）
- 本 PR：正确路由 blocked/done/not-dev，reason+action 组合透传，done 时 kill guardian + rm 灯文件

**Bug 3（衍生）**：现有 T1-T12 测试未 mock `classify_session`，v24 hook 默认 not-dev → 灯亮仍 release → T1/T4/T5/T8 失败。

### 下次预防

- [ ] 灯亮路由逻辑改动时，同步检查 classify_session 所有返回状态（blocked/done/not-dev/error）是否都有对应分支
- [ ] 任何 hook 行为改动，必须同步更新 T1-T12 的 mock 配置（beforeEach 中 classify mock 是 v24 hook 的必要基础设施）
- [ ] 新 PR 修复 bug 后，检查 T13-T16 同类测试是否已覆盖（本次 #3061 合并时缺少此检查）
- [ ] stale base（基于旧 main 的分支）出现时，优先 cherry-pick 净新增而非 rebase（避免带入已修复文件的旧版本）
