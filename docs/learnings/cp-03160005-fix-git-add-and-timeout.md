---
id: learning-fix-git-add-and-timeout
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
branch: cp-03160005-fix-git-add-and-timeout
changelog:
  - 1.0.0: 初始版本
---

# Learning: git add -A 改 -u + Stop Hook 90 分钟超时保护

## 背景

本次修复两个 /dev 工作流安全和可靠性问题。

## 根本原因

### git add -A 安全风险

`git add -A` 会将工作目录中所有文件（包括未追踪文件）加入暂存区。在 /dev 工作流中，agent 工作目录可能存在 `.env`、临时凭据文件、调试日志等未追踪的敏感文件，使用 `git add -A` 可能意外将这些文件提交到 git 历史。

`git add -u` 只暂存已被 git 追踪的文件的修改，完全避免此问题。

### Stop Hook CI pending 无超时

当 CI runner 挂死（如 HK VPS runner 离线）时，`devloop-check.sh` 会持续返回 `blocked`，导致 Stop Hook 无限循环阻止会话结束，agent 永远无法退出。需要一个全局超时机制。

## 解决方案

1. 将 `03-prci.md` 中所有 `git add -A` 替换为 `git add -u`（Step 8.4 和 9.2b ⑤）
2. 在 `devloop-check.sh` 的 CI pending 分支中，先读取 `.dev-mode.<branch>` 的 `started:` 字段，计算已用时间，超过 90 分钟则 `exit 0` 并打印手动检查提示

## 下次预防

- [ ] 新增 /dev 工作流文档时，提交相关命令默认用 `git add -u`
- [ ] Stop Hook 逻辑中凡涉及"无限等待"场景，必须配套超时保护
- [ ] 超时时间 90 分钟参考 Engine L3 Code Gate 最长耗时（16 分钟），设置足够余量
