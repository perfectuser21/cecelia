# Learning: dev-lock 丢失导致 stop hook fail-open

**分支**: cp-0410204656-e7cb8455-7ffc-4b67-844e-442f82
**日期**: 2026-04-11

---

### 根本原因

1. **stop-dev.sh fail-open**：`[[ -z "$DEV_LOCK_FILE" ]] && exit 0` — 当 dev-lock 文件因 context 重置丢失时，stop hook 不做任何检查直接允许 Claude 退出，导致 PR 创建前/CI 等待中工作流无声失控。

2. **00-worktree-auto.md dev-lock 重建两个 bug**：
   - 旧逻辑用 `cp "$DEV_MODE_FILE" "$DEV_LOCK_FILE"` 复制 dev-mode 来重建 dev-lock，但 dev-mode 没有 `session_id`/`tty` 字段，`_session_matches` 依赖这些字段匹配，导致重建后的 dev-lock 永远找不到当前会话。
   - `$(tty 2>/dev/null || echo "none")` 在 heredoc 内执行：无 TTY 时 `tty` 命令输出 "not a tty" 到 stdout 并退出 1，`|| echo "none"` 追加输出 "none"，heredoc 捕获两行，lock 文件变成格式错误的多行值。

### 修复内容

**stop-dev.sh**：将 `exit 0` 替换为 fail-closed 检查 — 当无 dev-lock 且当前在 `cp-*` 分支时，扫描所有 worktree 中匹配分支的 dev-mode 文件，若有未完成项则 `exit 2` 阻止退出，提示 Step 0 会自动重建。

**00-worktree-auto.md**：
- 重建路径改为 heredoc + session 字段（不再 cp dev-mode）
- 将 `tty` 计算移到 heredoc 外：`_LOCK_TTY=$(tty 2>/dev/null) || _LOCK_TTY="none"`，heredoc 内引用 `${_LOCK_TTY}` 变量

### 下次预防

- [ ] heredoc 内避免直接调用任何可能输出多行或 stderr 到 stdout 的命令（`tty`、`date` 组合、有错误输出的命令）
- [ ] dev-lock 重建必须生成完整格式：`dev`/`branch:`/`session_id:`/`tty:`/`created:` 五个字段
- [ ] stop hook 路径：任何 `exit 0` 分支前必须问：是否存在活跃 dev-mode 但无 dev-lock 的场景？
