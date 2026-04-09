# Sprint PRD

## 产品目标

验证 Brain harness 管线中 **verdict=null → fallback → PROPOSED → Reviewer R1 自动创建** 的完整链路正常工作。背景：PR #2118 修复了 `harness_contract_propose` 在 agent 完成但未输出 PROPOSED 关键字时 GAN 链路沉默中断的问题，本次 Sprint 验证该修复在新 Brain 进程下端到端有效。

目标用户：Brain 调度器 + 开发团队，目标是确认 harness pipeline 不再因 verdict=null 卡死。

## 功能清单

- [ ] Feature 1: verdict=null fallback 路径生效 — 当 Proposer 完成但未输出 PROPOSED 关键字时，系统自动 fallback → PROPOSED，链路继续
- [ ] Feature 2: Reviewer R1 任务自动派发 — fallback 发生后，系统自动创建 `harness_contract_review` 任务（Round 1）
- [ ] Feature 3: fallback 事件有日志记录 — execution.js 在 fallback 时输出 `verdict=null，fallback→PROPOSED` 警告日志，可追溯

## 验收标准（用户视角）

### Feature 1: verdict=null fallback 路径
- 当 Proposer agent 正常完成（AI Done）但结果中不含 `PROPOSED` 关键字时，系统不中断管线，自动将 verdict 视为 PROPOSED
- fallback 后任务状态正确更新为 completed，result 中写入 `{ verdict: "PROPOSED" }`

### Feature 2: Reviewer R1 自动派发
- fallback 触发后，Brain 数据库中出现新的 `harness_contract_review` 任务
- 该任务的 payload 中正确携带 `propose_round`、`planner_branch` 等上下文

### Feature 3: fallback 日志可追溯
- Brain 进程日志（或任务 error_message/payload）中可查到 `fallback→PROPOSED` 字样
- 不应有 "silent failure"（任务完成但链路无后续）

## AI 集成点（如适用）

- 不适用：本次 Sprint 为纯验证，不引入新 AI 集成

## 不在范围内

- 修改任何生产代码
- 验证完整 GAN 对抗轮次（多轮 Propose/Review 直到 APPROVED）
- 验证 Reviewer 审查质量
- 测试 Generator / Evaluator 阶段
