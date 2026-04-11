---
branch: cp-04111016-pipeline-callback
pr: 2211
date: 2026-04-11
type: pipeline_rescue
---

# Learning: Pipeline 状态机与 .dev-mode 同步

## 背景

PR #2211 实现了 pipeline 完成回调 zenithjoy 功能。代码已提交、PR 已创建、CI 全部通过，
但 Pipeline Patrol 仍报告 `step_2_code 停留 25 分钟`，触发了 pipeline_rescue 任务。

### 根本原因

原始 dev 会话完成了代码编写（step_2_code）并创建了 PR（step_3_integrate），
但 `.dev-mode` 文件中的阶段状态未被更新（两个阶段都标记为 `pending`）。

Stop Hook（devloop-check.sh）读取 `.dev-mode` 判断阶段完成度，
当 `step_2_code: pending` 时会 exit 2（继续等待），Pipeline Patrol 因此误判为"卡住"。

### 下次预防

- [ ] 在 Stage 2 代码验证完成后，立即写入 `.dev-mode` 中 `step_2_code: done`
- [ ] 在 PR 创建成功后，立即写入 `step_3_integrate: done` + `pr_number` + `pr_url`
- [ ] 每个阶段完成是"写代码 + 更新状态"两件事，缺一不可
- [ ] Pipeline Rescue 优先检查 `.dev-mode` 状态是否与实际进度一致，
      若 PR 已存在但状态未更新，直接修正状态后推进至 Stage 4

### 修复动作

pipeline_rescue agent 将 `.dev-mode` 中 step_2_code 和 step_3_integrate 更新为 done，
CI 通过后正常执行 Stage 4（Learning + 合并 + 清理）。
