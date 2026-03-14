---
id: learning-fix-l4-runner-m1
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03141053-fix-l4-runner-m1
pr: "941"
changelog:
  - 1.0.0: 初始版本
---

# Learning: L4 CI runner 机器分工

## 背景

PR #925 为解决 M1 无 Homebrew 的问题，临时将 `ci-l4-runtime.yml` 的 `runs-on` 改成 `xian-mac-m4`。

## 正确的机器分工

| 机器 | 用途 |
|------|------|
| **xian-mac-m1** | 专用 CI runner — 跑 GitHub Actions L4 |
| **xian-mac-m4** | LLM 任务机 — 跑 Codex/Claude Code 无头任务 |

## 关键经验

1. **M4 不是 CI 机器**：M4 是 Codex 执行机，不应参与 CI 流程，占用 M4 会影响 LLM 任务调度。

2. **M1 已装好环境**：PR #934 已在 M1（xx-macmini@100.103.88.66）安装 Homebrew + postgresql@17 + pgvector，M1 完全具备 L4 运行条件。

3. **及时还原临时方案**：临时 workaround 要有跟进 PR 及时还原，不能让错误配置长期留在 main。

## 修复内容

- `.github/workflows/ci-l4-runtime.yml`: `xian-mac-m4` → `xian-mac-m1`
