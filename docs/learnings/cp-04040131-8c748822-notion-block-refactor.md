---
branch: cp-04040131-8c748822-b78d-40ad-9601-6a265c
task_id: 8c748822-b78d-40ad-9601-6a265c4b531d
date: 2026-04-04
---

# Learning: notionBlockToDBRow 重构任务重复派发

### 根本原因

Brain 在 PR #1863（commit d3afd8f91）合并后仍将同一重构任务（task_id: 8c748822-b78d-40ad-9601-6a265c4b531d）保持为 `in_progress`，导致本次 agent 被重新调度来执行已完成的工作。

具体：
- PR #1854 已将 `notionBlockToDBRow` 从 CC=24 的 if/switch 链重构为 dispatch-table（CC=2）
- PR #1863 将 #1854 合并进 main
- 但 Brain 任务未被及时回写为 `completed`，触发了重试

### 下次预防

- [ ] PR 合并后必须立即执行 Brain 任务回写（PATCH /api/brain/tasks/{id} status=completed）
- [ ] Brain 任务调度器在派发 dev 任务前，应检查对应功能是否已存在于 main 分支代码中
- [ ] 若 3 次连续失败（exit 137 = OOM killed），应降低任务优先级或分拆为更小粒度，而非无限重试
