# Learning: devloop-check.sh + stop-dev.sh P0/P1 Bug 修复

**Branch**: cp-03221547-fix-devloop-stop-hooks
**Date**: 2026-03-22
**Task ID**: 84c967fd-43b9-4c6b-88a8-9ceb720d7f94

---

## 修复摘要

本次修复 4 个 P0/P1 问题，涉及 `/dev` pipeline 的 runtime 层两个关键文件。

---

## Bug 1: devloop-check.sh cleanup 失败无重试

### 根本原因

PR 合并后、step_4_ship 未 done 时，devloop-check.sh 尝试执行 cleanup.sh，但使用 `|| true` 吞掉了失败，没有任何错误提示，直接返回 `return 2`。虽然 `return 2` 本身会触发 stop hook 重试，但 cleanup 失败时不打印错误日志，导致问题难以诊断。

### 修复

将 `(cd ... && bash cleanup.sh ...) || true` 改为 `if ! ...; then echo "⚠️ cleanup.sh 执行失败，exit 2 重试..." >&2; fi`，保留 return 2 重试语义，同时打印失败日志。

### 下次预防

- [ ] cleanup.sh 失败路径必须有日志输出，不能静默吞掉 `|| true`
- [ ] 关键 pipeline 路径的 shell 命令加 `|| echo "⚠️ ..."` 而不是 `|| true`

---

## Bug 2: stop-dev.sh `_collect_search_dirs` 搜索顺序

### 根本原因

在 worktree 内调用时，`git rev-parse --show-toplevel` 返回 worktree 路径（而非主仓库路径）。`_collect_search_dirs` 先 `echo "$root"` 输出 worktree 路径，然后通过 `git worktree list` 枚举其他路径。虽然主仓库也在列表里，但当主仓库 `.dev-lock` 存放在主仓库根目录时，搜索顺序可能导致 worktree 内的空目录被优先搜索，浪费了扫描时间且在极端情况下可能遗漏。

### 修复

修改 `_collect_search_dirs`：先通过 `git worktree list --porcelain` 的**第一行**获取主仓库路径（porcelain 格式始终先列出主仓库），再输出其他 worktree。引入 `_main_root` 变量存储主仓库路径，确保主仓库始终优先搜索。

### 下次预防

- [ ] worktree 相关路径操作要区分「当前 worktree」和「主仓库」
- [ ] `git rev-parse --show-toplevel` 在 worktree 内返回 worktree 路径（不是主仓库），使用时要注意

---

## Bug 3: stop-dev.sh 垃圾注释

### 根本原因

注释「无头模式：不再旁路」描述的是删除操作（"无头模式旁路已删除"），但注释写成了功能声明，后面没有对应代码，成了孤立的说明性注释，增加阅读干扰。

### 修复

直接删除该注释块（4 行）。

---

## Bug 4: TTY 匹配条件过于复杂

### 根本原因

TTY 匹配条件 `[[ -n "$_lock_tty" && "$_lock_tty" != "not a tty" && -n "$_PRE_TTY" && "$_PRE_TTY" != "not a tty" ]]` 在 4 处（2 处预检查 + 2 处主匹配 + H7-008）重复出现，逻辑可以简化为「非空则参与匹配」。

同时，测试文件 `stop-hook.test.ts` 需要同步更新，反映新的非空检查语义。

### 修复

将 `[[ -n "..." && "..." != "not a tty" && ... ]]` 简化为 `[[ -n "..." && -n "..." ]]`。更新测试匹配新正则。

### 下次预防

- [ ] 修改 hook 行为验证正则时，同步更新 `stop-hook.test.ts` 对应测试
- [ ] 测试中对 shell 代码做 `toMatch` 断言时，regex 要与新代码结构对齐

---

## Bug 5: LEGACY 代码无删除日期

### 根本原因

`report_step_to_brain` 函数中的 LEGACY 字段兼容代码只有「LEGACY」标注，没有明确的删除日期，导致永远不会被清理。

### 修复

所有 LEGACY 注释统一加上「可在 2026-09-01 后删除」，给维护者明确的清理时间节点。
