# Learning: /dev 流程 Lite 路径分流

**Branch**: cp-03312104-dev-lite-path
**Date**: 2026-03-31

### 根本原因

所有任务无论规模都走完整 Sprint Contract 路径，fix:/chore: 等小改动也需要 Planner subagent + 2轮 Sprint Contract，开销与任务价值不对等。

根本原因是 `/dev` Stage 1 缺乏任务规模判断前置路由：流程设计时假设所有任务复杂度相同，导致 fix: 修复一行 bug 也要走 Planner + Sprint Contract 全流程，路径固化、无法适应小任务。

这导致 Planner 和 Sprint Contract 的价值被稀释——当任务规模确实很小（commit type=fix, 文件数≤3, 无新 API/schema）时，两轮 Sprint Contract 产出的"规格"几乎等同于直接写 DoD，却消耗了额外的 subagent 调用和等待时间。

### 下次预防

- [x] 路由决策写物理 seal 文件（`.dev-gate-lite.{branch}`）防止自认证
- [x] `task_track: lite/full` 写 `.dev-mode` 作为下游脚本（verify-step/devloop-check）的判断依据
- [x] 5 条件必须全部满足才走 LITE 路径（AND 逻辑，不是 OR），避免误判
- [x] LITE 路径 CI 门禁不豁免，只豁免流程层检查（Planner seal / Sprint Contract seal）
- [ ] 将来如需调整 LITE 阈值，修改 `01-spec.md §1.1.7` 的 5 条件说明，不需要改 verify-step.sh

### 关键设计决策

1. **5条件 AND 逻辑**：任意一条不满足 → FULL 路径，避免误走 LITE 导致规格不足
2. **物理 seal 文件**：`.dev-gate-lite.{branch}` 作为 verify-step.sh 和 devloop-check.sh 的物理凭证，防止主 agent 自认证
3. **25分制评分**：LITE 路径无 Planner/Sprint Contract 对抗，不适合用 40 分制，改为 CI+留痕+Lite规范度 共25分
4. **不改 sprint-contract-loop.sh**：保持 FULL 路径完整不变，LITE 只是在判断分支处绕过
