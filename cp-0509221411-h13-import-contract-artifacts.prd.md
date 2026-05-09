# PRD: H13 spawnGeneratorNode import contract artifacts

**Brain task**: 4b0cce61-5cbd-4371-9795-4d782503a308
**Spec**: docs/superpowers/specs/2026-05-09-h13-import-contract-artifacts-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-3

## 背景

W8 v14 evaluator 自己说出根因：'DoD 文件 contract-dod-ws1.md 在当前 generator worktree 中不存在 — 它只存在于 proposer 分支上。'

H11 让 generator 用独立 worktree fresh off main，没合并 proposer 分支的 sprints/ 目录（含 contract-dod-wsN.md / tests/wsN/ / task-plan.json）。Generator 容器看不到合同 → 自己产 docs/learnings 当 skeleton → evaluator 找不到 DoD 要的 trigger.sh → FAIL。

## 修法

spawnNode 拿 worktreePath 后、spawn 容器前，调 git fetch + checkout proposer 分支 sprints/ 到 worktree + commit。state 加 contractImported 字段防 resume 重 import。

## 成功标准

- generator 容器 worktree 含 sprints/ 目录（来自 proposer 分支）
- evaluator stdout 不再说 'DoD 文件不存在'
- W8 v15 evaluate verdict=PASS

## 不做

- 不动 H7-H12
- 不动 generator/proposer/evaluator/reviewer SKILL
- 不引入完整 contract enforcement layer
