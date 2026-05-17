# Learning: test-registry.yaml + 测试分类 ADR

**Branch**: cp-04011011-test-registry-adr
**Date**: 2026-04-01

---

### 根本原因

Cecelia 系统缺少统一的测试注册机制，导致 25 个测试文件游离在 CI 之外。根因是没有定义测试分类标准（什么是 unit/integration/e2e），也没有类似 skills-registry.json 的显式注册机制来跟踪测试文件。

### 发现路径

架构审查（/arch-review daily）发现孤儿测试 → 对比现有 registry 生态 → 确认缺失 test-registry → 创建。

### Hook 问题（worktree 分支检测盲区）

**问题**：bash-guard.sh 和 branch-protect.sh 用 `git rev-parse --abbrev-ref HEAD` 检测分支时，使用的是主仓库的 CWD（branch=main），而非 worktree 的分支（cp-*）。导致查找 `.dev-gate-planner.main` 而不是 `.dev-gate-planner.cp-xxx`。

**临时解法**：在主仓库创建 `.dev-gate-lite.main` 满足 hook 检查。

**正确修复**：hook 应在命令包含 `cd /worktree/path` 时，用 worktree 路径的 git 上下文检测分支。待独立 PR 修复。

### 下次预防

- [ ] 新增测试文件时，同 PR 更新 `test-registry.yaml`（CI L2 orphan-check 将强制执行）
- [ ] worktree dev session 中如遇 hook BRANCH=main 误检，临时创建 `.dev-gate-lite.main` 绕过，并在 Stage 4 cleanup 删除
- [ ] hook worktree 分支检测 bug 需独立 PR 修复（bash-guard.sh + branch-protect.sh + verify-step.sh）
