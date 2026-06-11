# Learning: serial gate resume 终局误判（P0 误杀在飞兄弟 run）

## 现象

harness initiative 同一签名失败两次（task d8acba51 02:10 / c0e2546b 03:57）：
`Serial gate: sub-task ws1 did not merge (status=queued). Next workstream blocked.`
共性：run 在 GAN/generator 在飞期间，另一 PR merge 触发 auto-version 部署重启 Brain。

## 根本原因

`advanceTaskIndexNode`（serial gate）在 restart-resume 路径上**用陈旧 checkpoint 状态做终局判断**。
部署重启 → startup-sync re-queue + dispatcher resume → 恢复图走到 serial gate 时，当前 sub_task
状态仍是 checkpoint 旧值（`queued`/未 merged，`queued` 是 status channel 默认值）。旧逻辑
`if (record.status !== 'merged')` 不验任何持久事实源，直接判 `terminal FAIL` → reportNode 标 failed。

在飞工作本可恢复（B59-idem 复用合同、generator/evaluator 幂等、PR 可能已实际 merged 只是 state 未刷新），
却被陈旧 checkpoint 误杀。并行模式下每次 merge 部署重启都会连带杀掉兄弟 run。

讽刺的是同文件 reportNode（merge-race 纠正）、`_waitForSubGraphCompletion`（B1/liveness）早已用
`_checkPrMerged` 回查 GitHub 真实状态再判定——唯独 serial gate 这条终局路径漏了这层校验。

## 修复

serial gate 判 FAIL 前对 `status !== 'merged'` 的 sub-task 从持久事实源重导出真实状态：
1. PR 已 merged（`gh pr view`）→ 纠正状态并放行推进（与既有 merge-race / #3341 短路同语义）；
2. status=queued 无终败证据 → 不判 FAIL，不递增 index，重新进入 run_sub_task 复用幂等链路；
3. genuine failed → 保持 terminal FAIL。
新增 `serial_gate_requeue_count`（上限 2）防修复自身死循环。

## 下次预防

**终局判断必须基于持久事实源，不能信 resume 时的陈旧 checkpoint。** 任何在 resume 路径上会被走到、
且会做 terminal 决策的节点，判定前都必须回查 PR/DB/分支等持久真相，绝不直接信 checkpoint 透传的
channel 默认值（尤其 `queued`）。

- [ ] 审计所有图节点：在 resume 路径会走到 + 做 terminal 决策的，是否都先验持久事实源？
- [ ] checkpoint channel 默认值（`queued` 等）禁止直接作为终局判据，必须先 reconcile
- [ ] 新增 serial/终局 gate 时，复用既有 `_checkPrMerged` reconcile 模式，不另起炉灶
