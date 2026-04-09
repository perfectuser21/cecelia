# Sprint PRD

## 产品目标

验证 PR #2118 修复的有效性：当 `harness_contract_propose` 任务返回 `verdict=null` 时，系统应自动 fallback 为 `PROPOSED` 状态，并继续驱动 GAN 对抗链路完整执行至 `sprint-report.md` 生成，全程零人工干预。目标用户是 Harness Planner 系统本身（自动化验证），确保 Brain 调度链路在边缘情况下不沉默中断。

## 功能清单

- [ ] Feature 1: verdict=null fallback 触发 — 系统在 `harness_contract_propose` 返回 null verdict 时自动将任务标记为 PROPOSED
- [ ] Feature 2: GAN 链路连续推进 — Proposer → Reviewer → Generator → Evaluator 全链路在无人工干预下顺序完成
- [ ] Feature 3: 最终 Report 生成 — GAN 完成后自动触发 `sprint-report`，生成 `sprints/sprint-report.md`

## 验收标准（用户视角）

### Feature 1: verdict=null fallback
- 当 Proposer 产出 verdict=null 时，Brain tick 检测到后将合同状态自动置为 PROPOSED，不停滞
- 日志中可见 fallback 触发记录（`verdict null → PROPOSED`）
- 任务状态在 Brain DB 中正确流转，不卡死在 `pending` 或 `null` 状态

### Feature 2: GAN 链路连续推进
- Proposer 完成后，Brain 自动创建 Reviewer 任务，无需人工触发
- Reviewer 完成后，Brain 自动创建 Generator 任务
- Generator 完成后，Brain 自动创建 Evaluator 任务
- 整条链路从启动到完成，不需要任何人工 curl / dispatch 介入

### Feature 3: 最终 Report 生成
- Evaluator 完成后，`sprints/sprint-report.md` 文件自动出现在 worktree 中
- Report 内容包含：目标摘要、GAN 对抗轮次、最终验收状态
- Brain 任务状态更新为 `completed`

## AI 集成点（如适用）

- Proposer / Reviewer / Generator / Evaluator 均为 AI agent（Claude），通过 Brain 任务调度串联
- 验证重点是 Brain 调度层（非 AI 内容质量）

## 不在范围内

- 不验证 GAN 内容质量或对抗轮次的合理性
- 不测试 verdict=null 以外的异常场景（如网络超时、DB 连接失败）
- 不修改现有代码，本 Sprint 纯验证 PR #2118 修复效果
- 不需要多轮 GAN 对抗，一轮通过即满足验证目标
