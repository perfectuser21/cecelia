---
id: learning-cp-04041620-fix-engine-devloop-stophook
branch: cp-04041620-cp-04040000-fix-engine-devloop-stophook
date: 2026-04-04
scope: engine
type: bug-fix
---

# Learning: Engine P0+P1 Bug — devloop-check return 错误 + stop-dev 死代码

## 问题描述

### P0: devloop-check.sh — cleanup_done 后 return 2

`devloop_check()` 在 PR 已合并 + step_4_ship done 的路径下：
1. 正确调用了 `_mark_cleanup_done` 写入 `cleanup_done: true`
2. 然后输出 `status: "blocked"` + `return 2`（错误！）

这导致 Stop Hook 永远无法通过这条路径退出——`_mark_cleanup_done` 写完 `cleanup_done: true` 后，下次循环会在条件 0 正确返回，但当次调用却以 blocked 返回，浪费一个 tick。

**根因**：逻辑设计意图是"标记后等下次检测"，但实际上 cleanup_done 已经写好，当次就可以直接返回 done。

### P1: stop-dev.sh — 从 .dev-mode 读 tty/session_id 的死代码

`.dev-mode` 文件格式：
```
dev
branch: cp-xxx
task_card: .task-xxx.md
started: ...
step_N_xxx: ...
```

它不包含 `tty` 或 `session_id` 字段（这些字段在 `.dev-lock` 中）。

stop-dev.sh L117-126 尝试从 `.dev-mode` 读取这些字段做二次会话隔离，结果永远读到空值，所有 `if` 永远不成立，是死代码。会话隔离已在 L63-73 的 `_session_matches()` 通过 `.dev-lock` 完成。

## 修复方案

### P0 修复
```bash
# 之前（错误）
_mark_cleanup_done "$dev_mode_file"
_devloop_jq -n '{"status":"blocked","reason":"...等待下次检查退出..."}'
return 2

# 之后（正确）
_mark_cleanup_done "$dev_mode_file"
_devloop_jq -n '{"status":"done","reason":"Stage 4 Ship 已完成，cleanup_done 已标记，工作流结束"}'
return 0
```

### P1 修复
删除 stop-dev.sh 中从 `.dev-mode` 读取 `branch/tty/session_id` 的死代码（原 L117-126），BRANCH_NAME 改为直接使用 `.dev-lock` 扫描阶段已读取的 `_lb` 变量。

## 根本原因

- **P0**：代码意图（等下次检测）和实现（已标记完成可直接放行）不一致，copy-paste 了错误的 `return 2`
- **P1**：`.dev-mode` 和 `.dev-lock` 的字段职责混淆，写会话隔离代码时没有核对文件格式

## 下次预防

- [ ] `devloop_check()` 中每个 `_mark_cleanup_done` 调用后，必须紧接着 `return 0`（cleanup_done = done = 结束，绝不 return 2）
- [ ] 修改 stop-dev.sh 会话隔离逻辑时，只读 `.dev-lock` 字段（tty/session_id/branch），不读 `.dev-mode`
- [ ] `.dev-mode` 的格式说明应该在代码注释中明确：只有 dev/branch/task_card/started/step_N_xxx 字段
