# Harness v2 Phase A GAN Contract Loop

### 根本原因

Harness v2 Phase A 定义里只有 Planner 建 draft 合同，Proposer/Reviewer 对抗循环从未接入 runner。结果 `initiative_contracts.status` 永远是 draft，PR-3 phase advancer 等不到 approved 就不会晋级，Initiative 永远卡在 A_contract。这是典型的"状态机定义齐全但推进代码空缺"。

### 下次预防

- [ ] 新状态机必须同时实现"状态变迁触发器"而不是只定义状态枚举（本 PR 是例二，PR-3 是例一）
- [ ] GAN 循环不加轮次上限（memory `harness-gan-design.md` 的刻意设计），只加预算兜底（budgetCapUsd）
- [ ] 任何"循环 + LLM 调用"必须先在单测里用 mock 模拟 2-3 轮才真机跑，避免真机调试烧钱
- [ ] Reviewer 输出不含 VERDICT 时默认 REVISION（保守放大对抗）而非 APPROVED（避免静默放行）
- [ ] `initiative_runs.phase` 在事务内直接开到 B_task_loop（合同已 approved）省一个 tick，比"先 A_contract 让 advancer 下轮晋级"更干脆
