# Learning: dev-lock 丢失导致 stop hook fail-open

**Branch**: cp-0410203826-e7cb8455-7ffc-4b67-844e-442f82
**Date**: 2026-04-11

## 根本原因

1. **stop-dev.sh fail-open**：当 `.dev-lock` 文件在运行期间丢失（会话压缩/context 重置等场景），`_session_matches` 找不到匹配的 lock 文件，直接 `exit 0` 让 Claude 自由退出，即使 `.dev-mode` 仍有未完成的 step。

2. **dev-lock 重建缺少 session 字段**：`00-worktree-auto.md` 检测到 `.dev-mode` 存在但 `.dev-lock` 缺失时，用 `cp dev-mode dev-lock`。复制的文件没有 `tty:` / `session_id:` 字段，但这并非致命问题（`_session_matches` 有空 tty 的分支兜底）。真正的问题是：若 `.dev-mode` 没有 `branch:` 字段（旧格式），`lock_branch` 为空则永远不匹配。

3. **branch-protect.sh 正则仅允许 8 位时间戳**：`worktree-manage.sh` 使用 `date +%m%d%H%M%S`（10位含秒），但 branch-protect.sh 正则为 `[0-9]{8}`，Brain 自动派发的 worktree 分支全部被误判为"非法分支"，Edit 工具被 hook 拦截。

## 下次预防

- [ ] branch-protect.sh 正则修改后，同步检查是否与 worktree-manage.sh 的时间戳格式一致
- [ ] stop-dev.sh 任何 `exit 0` 路径都要先确认无活跃 dev-mode（fail-closed 原则）
- [ ] dev-lock 重建永远使用 `cat > file <<EOF` 模板而非 `cp`，确保必要字段完整
- [ ] Brain 派发 worktree 时，确认分支格式与所有门禁正则兼容
