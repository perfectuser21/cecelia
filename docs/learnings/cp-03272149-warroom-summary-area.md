---
branch: cp-03272149-warroom-summary-area
date: 2026-03-27
type: learning
---

# Learning: War Room Summary + Area 详情页架构

## 根本原因

并行 agent 冲突：Brain 将同一任务（task_id: 5265d872）同时派给了多个 agent。本 agent（account1）和另一个 agent（account2/cp-03272143-warroom-summary）并行开发，后者先完成并合并（PR #1633），本 agent 开发完成时发现重复。

按照并行 agent 规则：检查 main 最新 commit 是否已有同功能合并，若是则直接关闭自己的 PR，避免重复合并和代码冲突。

## 下次预防

- [ ] 在 Stage 1 Spec 阶段就检查是否已有同 task_id 的活跃 PR（`gh pr list --search "Brain Task: <task_id>"`）
- [ ] 发现并行冲突时立即停止，不要完成全部代码再关闭 PR（浪费算力）
- [ ] Brain 派发任务时应设置 `execution_mode: single` 避免多 agent 竞争同一任务
