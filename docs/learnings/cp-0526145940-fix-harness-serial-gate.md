# Learning: Harness Serial Gate — advanceTaskIndexNode merge 检查

**PR 分支**: cp-0526145940-fix-harness-serial-gate

### 根本原因

`advanceTaskIndexNode` 无条件递增 `task_loop_index`，不检查上一个 sub-task 是否真正 merged。
当 WS N 子图因任何原因（no_pr / timeout / failed / status:undefined）提前结束时，
initiative 照样推进到 WS N+1，导致"并行"开出多个 WS 的 PR，违反串行语义。

初版修复用 `subTasks[length-1]` 取最后一项，存在 E2E 重跑路径的 false positive 风险
（task_loop_index 重置为 0 时，length-1 是上一轮最后任务而非 WS1）。
正确做法：用 `taskPlan.tasks[idx].id` 在 sub_tasks 精确查找当前任务记录。

### 下次预防

- [ ] 所有「串行推进」节点上线前必须有针对 E2E 重跑路径的 regression test
- [ ] `advanceTaskIndexNode` 语义相同的新节点必须加相同 gate
- [ ] sub-task 子图早退路径（no_pr/timeout）应明确赋值 status，避免 status:undefined 歧义
