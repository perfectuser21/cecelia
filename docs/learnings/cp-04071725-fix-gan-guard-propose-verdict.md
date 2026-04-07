---
branch: cp-04071725-39ee9652-ed4d-4eab-84ec-32955a
date: 2026-04-07
task_id: 39ee9652-ed4d-4eab-84ec-32955a346c79
---

# Learning: GAN 守卫 — Proposer 失败时不应派 Reviewer

### 根本原因

`execution.js` Layer 2a 的 sprint_contract_propose 回调中，没有检查 Proposer 的 result.verdict，导致任何状态（包括 quarantine/auth 失败）完成的 Proposer 都会触发 Reviewer 的创建。Reviewer 没有合同草案，却返回了 APPROVED，使 GAN 对抗完全失效。

### 下次预防

- [ ] 所有 GAN 对抗链路在创建下游任务之前，必须显式检查上游 verdict 字段
- [ ] `sprint_contract_propose → sprint_contract_review` 的守卫条件：`verdict === 'PROPOSED'`
- [ ] 新增测试用例覆盖 verdict=null/undefined/FAILED 的负向路径
- [ ] quarantine 场景（auth 失败）的 execution callback 会携带 null result，这是预期行为，链路守卫必须处理
