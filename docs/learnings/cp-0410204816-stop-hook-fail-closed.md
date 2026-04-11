# Learning: stop hook fail-open + dev-lock 重建字段缺失

**分支**: cp-0410204816-e7cb8455-7ffc-4b67-844e-442f82
**日期**: 2026-04-11

---

### 根本原因

**问题 1: stop-dev.sh fail-open**
`stop-dev.sh:76` 无 dev-lock 时直接 `exit 0`（允许退出）。
当 dev-lock 丢失（context 恢复场景、crash、重启）时，Stop Hook 找不到锁就放行，Claude 在 PR 创建前/CI 等待中自由退出，导致任务中断而无人知晓。

**问题 2: dev-lock 重建缺字段**
`00-worktree-auto.md` 重建 dev-lock 时用 `cp "$DEV_MODE_FILE" "$DEV_LOCK_FILE"`。
dev-mode 文件不含 `session_id`/`tty`/`created` 字段，而 `_session_matches()` 依赖这些字段匹配会话。结果重建的 dev-lock 永远无法匹配，stop hook 视为无锁 → exit 0（再次 fail-open）。

**问题 3: branch-protect.sh regex 过窄**
Regex `^cp-[0-9]{8}-` 只支持 8 位时间戳（MMDDHHNN），但 Brain 生成的分支名带秒级精度（MMDDHHMMss，10 位）。所有 10 位时间戳分支无法通过保护门禁，无法编辑任何代码文件。

---

### 修复内容

1. **stop-dev.sh v16.3.0**: 无 dev-lock 时扫描所有 worktree 的 dev-mode 文件，有未完成步骤则 exit 2（fail-closed）
2. **00-worktree-auto.md v3.1.0**: dev-lock 重建改为生成含 `session_id`/`tty`/`created` 字段的标准格式（`cat > $DEV_LOCK_FILE`）
3. **branch-protect.sh v30**: regex 改为 `^cp-[0-9]{8,10}-` 兼容 8-10 位时间戳

---

### 下次预防

- [ ] Brain 分派任务时生成的分支名格式必须与 branch-protect.sh regex 保持一致（统一为 8 位或 10 位，选一种）
- [ ] dev-lock 重建逻辑测试：模拟 dev-lock 丢失场景，确认 stop hook 正确 block
- [ ] 任何生成 dev-lock 的代码路径（worktree-manage.sh、00-worktree-auto.md）都必须包含 session_id/tty/created 字段
- [ ] branch-protect.sh 修改后需同步更新 hooks/VERSION 中的版本注释
