# Learning: 内容注入 + Evaluator divergence 下限

**分支**: cp-03301026-content-inject-evaluator-divergence
**日期**: 2026-03-30

## 根本原因

1. **branch-protect hook 在子目录 packages/ 下查找 PRD 时，优先找子目录中的 .prd.md**（如 `packages/workflows/.prd.md`），而不是根目录的 per-branch PRD。这导致改 `packages/workflows/` 下的文件时，hook 认为 PRD 是旧任务的残留。

2. **bash-guard 和 branch-protect 的 git 上下文是主仓库**（即使在 worktree 中）：hook 运行时 `git rev-parse --abbrev-ref HEAD` 返回 `main`，而不是 worktree 的分支名。导致 seal 文件路径校验找的是 `.dev-gate-spec.main`，不是 worktree 分支的 seal 文件。

## 下次预防

- [ ] 在 `packages/workflows/` 子目录改文件时，必须同时在该目录创建 per-branch PRD/DoD（`.prd-{branch}.md` + `.dod-{branch}.md`）
- [ ] spec_review seal 文件需要同时写到主仓库根目录的 `.dev-gate-spec.main`（供 hook 验证），才能通过 bash-guard 和 branch-protect 的 gate 检查
- [ ] branch-protect 的 `find_prd_dod_dir` 会在子目录中找到旧 `.prd.md` 后停止向上查找，不会使用根目录的 per-branch PRD，需要在对应子目录也放 per-branch PRD

## 改动摘要

- `packages/engine/skills/dev/steps/02-code.md`：Generator subagent prompt 模板加内容注入注释，主 agent 伪码加内容注入说明
- `packages/workflows/skills/spec-review/SKILL.md`：Sprint Contract Gate 加 divergence_count = 0 → exit 2 下限检查
- Engine 版本 13.60.0 → 13.61.0（5 个文件同步更新）
