# PRD: serial gate resume 终局误判修复（P0 — 误杀在飞兄弟 run）

## 背景

harness initiative 图的 restart-resume 把在飞 sub-task 误判为终败。实证同一签名两次
（task d8acba51 / c0e2546b），均以
`Serial gate: sub-task ws1 did not merge (status=queued). Next workstream blocked.` 失败。

**时间线共性**：run 在 GAN/generator 在飞期间，另一 PR merge 触发 auto-version 部署重启 Brain
→ startup-sync re-queue + dispatcher resume → 恢复的图走到 `advanceTaskIndexNode`（serial gate）
检查，sub_task 状态还是 checkpoint 里的旧值（queued/未 merged）→ `record.status !== 'merged'`
直接判 terminal FAIL → reportNode 标 failed。

**根因**：serial gate 在 resume 路径上**用陈旧 checkpoint 状态做终局判断**。在飞工作其实可恢复
（B59-idem 复用合同、generator/evaluator 幂等），但 gate 不验持久事实源就终局误杀。并行模式下，
每次 merge 部署重启都会杀掉兄弟 run。

## 方案

`advanceTaskIndexNode` 在判 FAIL 前，对 `status !== 'merged'` 的当前 sub-task 从持久事实源
重导出真实状态（不信 resume 时的陈旧 checkpoint）：

1. **PR 已 merged**（`gh pr view` via 既有 `_checkPrMerged`）→ 与 reportNode/liveness 既有
   merge-race 纠正、#3341 短路同语义：纠正 `sub_tasks` 状态为 merged 并放行推进，绝不 FAIL。
2. **status=queued/缺失 且 PR 未 merged**（在飞工作被重启截断，无终败证据）→ 不判 FAIL，不递增
   `task_loop_index`，重新进入 `run_sub_task` 复用既有幂等链路继续推进当前 sub-task。
3. **genuine 终败（status=failed 等）** → 保持原 terminal FAIL 语义不变。

新增 `serial_gate_requeue_count` 通道（上限 `SERIAL_GATE_REQUEUE_CAP=2`）防本修复自身在病态
status 下死循环：重跑超上限仍未收敛 → terminal FAIL。

与 #3340（图级并发互斥）、#3341（merged 短路）、B59-idem 协同，不破坏其语义；不重构 serial
gate 本身，只修 resume 路径终局误判。

## 成功标准

- 6 条新 regression test 全绿：PR 已 merged 走短路、queued+PR 未 merged 重跑、queued 无 pr_url
  重跑、genuine failed 仍 FAIL、requeue 超上限 FAIL、正常 merged 推进
- workflows 套件无回归（380 passed）
- CI 全绿
