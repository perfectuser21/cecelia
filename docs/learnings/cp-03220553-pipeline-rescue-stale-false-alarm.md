# Pipeline Rescue 滞后误报 — cp-03222012-redesign-task-type-page

**分支**: cp-03220553-dd42154e-c1c1-4abb-841a-8b261c
**日期**: 2026-03-22
**类型**: pipeline_rescue（误报关闭）

---

### 根本原因

Pipeline Patrol 检测 `cp-03222012-redesign-task-type-page` 在 `step_2_code` 阶段停留 41 分钟（阈值 20 分钟），触发 rescue 任务。

但实际上该分支已经在更早时间完成：
- **PR #1379**（`fix(dashboard): 重组 TaskTypeConfigPage — ABCD 类别框架`）已合并到 main
- **PR #1380**（`docs(learning): pipeline rescue — cp-03222012-redesign-task-type-page`）已合并到 main
- 分支已从本地和远程删除

Brain 中也没有该分支对应的活跃任务。

**根因**：Pipeline Patrol 的检测周期与任务完成后的状态清理之间存在时间窗口。当一个任务完成（.dev-mode 删除、分支删除）后，如果 Patrol 快照仍记录了旧的 step 状态，会误判为"卡死"并产生新的 rescue 任务。

---

### 下次预防

- [ ] Pipeline Patrol 在发出 rescue 任务前，应先验证目标分支是否仍存在（`git ls-remote origin <branch>`）
- [ ] 若分支不存在，自动将 rescue 任务标记为 `false_alarm` 并跳过，无需派发给 Agent
- [ ] Brain 的 pipeline 状态表应在分支删除或 PR 合并后自动清除对应记录，避免僵尸状态积压
- [ ] rescue 任务创建前检查：`gh pr list --head <branch> --state merged` 若有结果则直接跳过
