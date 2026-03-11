---
branch: cp-03111836-dev-step6-simplify
date: 2026-03-11
---

# Learning: /dev Step 6.5 强制 Simplify 子步骤

## 问题

每次写完代码后，旧函数残留、重复逻辑、矛盾注释、无用 import 不会自动清理，靠 CI cleanup-check 被动门禁不够主动。

## 解决方案

在 `packages/engine/skills/dev/steps/06-code.md` Step 6 末尾（"完成后"之前）内联加入 Step 6.5 Simplify 子步骤。

### 根本原因

cleanup-check 是 DoD 关键词触发型，不是所有 PR 强制触发。代码写完时没有统一的清理检查点。

### 关键设计决策

- **内联指令**，不调用外部 skill（避免无法执行的空描述）
- **扫描范围**：只扫描 `git diff --name-only HEAD` 改动文件，不是全仓库
- **4 类必清问题**：旧代码残留 / 重复逻辑 / 矛盾注释 / 无用 import
- **完成标准**：4 个 ✅ 检查项，全部满足才进 Step 7

### 下次预防

- [ ] 所有代码写完步骤都需要"清理检查点"，不能只靠被动 CI
- [ ] 内联指令比外部 skill 调用更可靠（skill 路径可能不可用）
- [ ] Engine skills 改动必须：[CONFIG] tag + 6 文件版本 bump + feature-registry.yml 条目

