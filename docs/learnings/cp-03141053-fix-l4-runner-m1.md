---
id: learning-fix-l4-runner-m1
version: 1.1.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03141053-fix-l4-runner-m1
pr: "941"
changelog:
  - 1.0.0: 初始版本
  - 1.1.0: 补充根本原因、下次预防、checklist
---

# Learning: L4 CI runner 机器分工 — M1 vs M4

## 背景

PR #925 为解决 M1 无 Homebrew 的问题，临时将 `ci-l4-runtime.yml` 的 `runs-on` 改成 `xian-mac-m4`。PR #934 在 M1 上安装好环境后，需要还原。

## 根本原因

M1 是专用 CI runner，M4 是 LLM 任务机。两台机器用途不同，不应混用。PR #925 作为临时方案没有及时还原，导致 M4（LLM 机）长期承担 CI 任务，影响 Codex 任务调度。

## 正确的机器分工

| 机器 | 用途 |
|------|------|
| **xian-mac-m1** | 专用 CI runner — 跑 GitHub Actions L4 |
| **xian-mac-m4** | LLM 任务机 — 跑 Codex/Claude Code 无头任务 |

## 下次预防

临时 workaround（如改 runs-on 到非标准机器）需要：
1. PR 描述中明确写 "临时方案，需要跟进 PR 还原"
2. 立刻创建一个 pending 任务记录还原工作
3. 在环境就绪后（M1 装好 Homebrew）立刻创建还原 PR

## 操作清单

- [x] 确认 M1 已安装 Homebrew + postgresql@17 + pgvector（PR #934）
- [x] 将 `ci-l4-runtime.yml` 中 `runs-on` 改回 `xian-mac-m1`
- [x] 同步更新注释行
