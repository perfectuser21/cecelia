---
id: learning-cp-03132125-worktree-active-lock
version: 1.0.0
created: 2026-03-13
updated: 2026-03-13
changelog:
  - 1.0.0: 初始版本
---

## worktree-gc.sh 在活跃 session 期间误删 worktree（2026-03-13）

### 根本原因

`worktree-gc.sh` 在判断 worktree 是否可以 GC 时，只检查对应 PR 状态（已合并/已关闭）和 git dirty state，但没有检查该 worktree 是否正在被某个 Claude Code session 使用。当 /dev session 完成了所有 commit+push，但还在等待 CI 结果或正在执行 Step 10（Learning）时，worktree 的 git 状态是"干净的"（no uncommitted changes），而 PR 状态如果因为其他原因被误判为关闭，GC 就会直接删除这个 worktree，导致 session 崩溃（Bash 工具完全失效，无法继续执行）。

### 下次预防

- [ ] 任何"清理/GC"脚本在删除 worktree/工作目录前，必须先检查是否存在活跃锁文件（`.dev-session-active`）
- [ ] Stop Hook 启动时立即创建活跃锁文件（`touch $WT_PATH/.dev-session-active`），结束时删除
- [ ] `.dev-session-active` 必须加入 `.gitignore`，防止意外提交
- [ ] GC 脚本检测到锁文件时，输出 WARN 而不是静默跳过，方便排查
- [ ] 新增类似"清理"功能前，先问：该目录/文件是否可能正在被其他进程使用？

### 修复方案

**`worktree-gc.sh` v1.2.0**：在 `SHOULD_CLEAN == true` 的 dirty check 之前新增活跃锁检查——若 `$WT_PATH/.dev-session-active` 存在，则 `SKIPPED++` 并输出 WARN，跳过该 worktree。

**`stop-dev.sh` v15.1.0**：
1. 在 `BRANCH_NAME` 确定后，通过 `git worktree list --porcelain` 查找当前分支对应的 worktree 路径（`_WT_ACTIVE_PATH`）
2. 在路径有效时立即 `touch $WT_ACTIVE_PATH/.dev-session-active`，标记 session 活跃
3. 在三个 cleanup 完成点（`cleanup_done: true`、`devloop_check done`、fallback `STEP_11_STATUS == done`）删除锁文件

### set -u 陷阱

`stop-dev.sh` 使用 `set -euo pipefail` 严格模式。若变量 `_WT_ACTIVE_PATH` 声明位置晚于第一次 `cleanup_done: true` 检查，`set -u` 会导致整个脚本 `exit 1`，进而让 Stop Hook 误判为错误（实际等价于 exit 2，会继续循环，但破坏了预期行为）。

**修复**：必须在脚本顶部（`PROJECT_ROOT` 声明后）立即 `_WT_ACTIVE_PATH=""`，然后在逻辑块内再赋值。

### stop-cleanup-bugfixes 测试 500 字节窗口

测试 `R2-stop orphan retry cleanup` 和 `R2-cross dev-failure.log cleanup` 通过检查 `rm -f .dev-orphan-retry-sentinel` 附近 500 字节范围内是否同时出现 `cleanup_done` 关键字来验证代码结构。若在这两个关键字之间插入多行代码，会撑大间距超出 500 字节窗口，导致测试失败。

**修复**：将 `.dev-session-active` 的删除操作改为内联单行（`[[ -n "$_WT_ACTIVE_PATH" && -d "$_WT_ACTIVE_PATH" ]] && rm -f "$_WT_ACTIVE_PATH/.dev-session-active" 2>/dev/null || true`），且放在 `rm -f "$PROJECT_ROOT/.dev-orphan-retry-sentinel"` 之后，最大程度减小插入的字节数。
