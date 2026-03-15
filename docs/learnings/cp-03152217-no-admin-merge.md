---
branch: cp-03152217-no-admin-merge
date: 2026-03-15
task: 03-prci.md 禁止 --admin 合并
---

# Learning: 禁止 gh pr merge --admin

## 背景

PR #967 中因 L3 runner 看似 pending 超时，使用了 `gh pr merge --admin` 绕过 CI 强行合并。
实际上 L3 只是在正常跑测试（11-16 分钟），并未卡死。

## 根因

步骤文件没有明确禁止 `--admin`，导致 AI 在判断 CI "卡死"时选择了绕过。

## 修复

在 `packages/engine/skills/dev/steps/03-prci.md` 的「禁止行为」章节追加：
- `❌ gh pr merge --admin 绕过 CI`
- CI pending ≠ 卡死说明（11-16 分钟正常耗时）

GitHub 端已开启 `enforce_admins`，`--admin` 在系统层面已失效并直接报错。

## 规则

- **L3 Code Gate 正常耗时：11-16 分钟**（排队 ~5 分钟 + Unit Tests ~10 分钟）
- 看到 `pending` 不要以为 runner 挂了，继续等待
- `gh pr merge --admin` 已被 `enforce_admins` 封锁，不要尝试
