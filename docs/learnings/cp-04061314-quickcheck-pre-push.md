---
branch: cp-04061314-quickcheck-pre-push
date: 2026-04-06
task_id: 49ec2792-7d81-4690-bbbd-42c534e1fb1c
---

# Learning: 护城河1 — pre-push quickcheck

## 任务背景

实现 git push 前的本地快速检查机制，把 TypeCheck/ESLint/Unit Test 错误拦在 CI 之前。

## 根本原因

AI agent 写完代码直接 push，全量 CI 需要 8-15 分钟。本地 pre-push 检查可以在 60 秒内发现明显错误，节省大量等待时间。

## 实现决策

### 1. 检查范围按改动文件过滤，非全量

- 只检查有改动的 package（engine/brain/workspace）
- 只 lint 改动的 JS/TS 文件
- Unit test 按文件名匹配推导对应测试文件

### 2. hook 接入点

选择新建 `packages/engine/hooks/pre-push.sh` 而不是修改 branch-protect.sh：
- branch-protect.sh 是 Write/Edit 工具的 pre-hook，不是 git hook
- pre-push.sh 作为独立的 git pre-push hook 文件，由 Claude Code settings.json 配置

### 3. 与已有 pre-push-check.sh 互补

- `scripts/pre-push-check.sh`：检查 Brain 版本/migration 冲突（领域检查）
- `scripts/quickcheck.sh`：检查代码质量（TypeCheck/ESLint/Tests）

### 4. 版本 bump 陷阱

main 分支的 VERSION 文件被 linter 提前更新为 14.3.5，worktree 继承该状态。本次 hooks 改动需要在此基础上再 bump 到 14.3.6，6 个文件需同步更新。

## 下次预防

- [ ] Engine hooks 改动前先 `cat packages/engine/VERSION` 确认当前版本基线
- [ ] 版本 bump 使用 Edit 工具（不用 bash echo/sed，bash-guard 会拦截 main 分支写入）
- [ ] pre-push hook 安装说明需写在 README 或 CHANGELOG，否则新开发者不知道要 symlink
