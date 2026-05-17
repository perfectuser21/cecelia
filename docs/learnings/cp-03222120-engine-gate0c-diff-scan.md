# Learning: Gate 0c 全文扫描 → diff-only 扫描

**分支**: cp-03222120-engine-gate0c-diff-scan
**日期**: 2026-03-23
**PR**: 待合并

---

### 根本原因

`verify-step.sh` Gate 0c 使用 `grep -qE '^\s*console\.log\s*\(|...' "$full_path"` 扫描**整个文件**，
而非只扫描本次 PR 的新增行。任何含有结构化日志的文件（如 `executor.js` 含 58 处 `console.log`）
只要被 PR 改动，Gate 0c 就会误报为"含调试垃圾代码"并阻止 push。

### 下次预防

- [ ] Gate 0c 扫描逻辑变更时，优先考虑"只扫 diff 新增行"而非"全文件扫描"
- [ ] 添加结构化日志文件到 Gate 0c 排除名单（`.js` 文件含大量生产 log 是正常现象）
- [ ] 如果 Gate 报错涉及"预存在内容"，先检查是全文扫描还是 diff 扫描

### 变更说明

修改 `packages/engine/hooks/verify-step.sh` Gate 0c：
```bash
# Before（全文件扫描 — 有误报）:
if grep -qE '^\s*console\.log\s*\(|^\s*debugger\s*;?' "$full_path" 2>/dev/null; then

# After（只扫 diff 新增行 — 语义正确）:
local diff_added=""
diff_added=$(git diff "origin/${base_branch}...HEAD" -- "$fpath" 2>/dev/null || \
             git diff "${base_branch}...HEAD" -- "$fpath" 2>/dev/null || echo "")
if echo "$diff_added" | grep -qE '^\+\s*console\.log\s*\(|^\+\s*debugger\s*;?' 2>/dev/null; then
```

### 附：hooks 不支持 worktree 上下文（已知 bug）

`branch-protect.sh` 中 `CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)` 从主仓库上下文运行，
当 .dev-mode 在 worktree 中时，分支名解析为 `main` 而非实际分支。
后续需修复 branch-protect.sh 从 FILE_PATH 中提取 worktree 路径并用 `git -C "$WORKTREE_PATH"` 运行。
