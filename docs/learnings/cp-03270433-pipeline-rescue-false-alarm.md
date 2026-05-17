# Learning: Pipeline Rescue 孤儿任务 = PR 已合并但未回写

**分支**: cp-03262112-sonnet-resets-at
**救援时间**: 2026-03-27
**结论**: 误报（false alarm）

---

### 根本原因

Pipeline Patrol 检测到 `cp-03262112-sonnet-resets-at` 停在 `step_3_integrate` 超过 32 分钟，标记为孤儿 pipeline 并触发 rescue。

实际情况：
- PR #1604 已于 2026-03-26 合并到 main
- 分支和 worktree 均已删除
- Brain 任务因上一次 rescue 被 watchdog kill（`liveness_dead`）而未能回写

**根因链**：PR 合并 → rescue task 被 watchdog kill → 任务状态卡在 `in_progress` → Pipeline Patrol 再次触发 rescue

### 下次预防

- [ ] Pipeline Patrol 在触发 rescue 前，应先检查对应分支的 GitHub PR 是否已 MERGED
- [ ] 若 PR 已合并，直接标记 Brain 任务 `completed`，无需派发 rescue agent
- [ ] rescue agent 自身的 liveness 问题已是已知模式（3次 `liveness_dead`），需要 Brain 层面的去重/短路逻辑

### 诊断步骤（可复用）

```bash
# 1. 查孤儿分支 PR 状态
REPO="perfectuser21/cecelia"
gh pr list --repo "$REPO" --head "cp-XXXXX-branch-name" --state all

# 若 MERGED → 直接回写 Brain 为 completed，无需任何代码修改
# 若 OPEN   → 检查 CI 状态，继续推进合并
# 若 CLOSED → 评估是否需要重新开发或放弃
```
