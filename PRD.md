# PRD — evaluate 节点在 PR 已 merge 时短路 PASS（修 fix-loop-on-merged-PR）

## 背景

本系统每次 merge 触发 auto-version 重启 brain → checkpoint 大概率断在 merge 节点后、写盘前 → 成功的 harness run 恢复时会重跑 evaluate 节点。此时 PR 已 merge、分支已删 → evaluator checkout 已删分支失败 / E2E FAIL → `routeAfterEvaluate` 把 FAIL 路由到 fix → 在【已 merge 的 PR】上 spawn generator（fix loop）。这是本系统的**常态而非边缘**（每个成功 run 恢复时都会撞）。

## 根因

`evaluateContractNode` 动作前不查 PR 是否已 merge，无条件 checkout PR 分支跑 E2E。PR 合并后分支删除 → evaluate 必 FAIL → fix loop。

## 修复

`evaluateContractNode` 在幂等门之后、spawn 之前，先 `gh pr view --json state` 查 PR 状态。已 `MERGED` → 短路返回 `evaluate_verdict='PASS'`（log `merged-short-circuit`），不再 checkout 已删分支跑 E2E、不触发 fix loop。合同已过 CI 合并即视为达标。查询失败 fail-open（当未 merge，继续正常 evaluate，绝不因查询失败误判 PASS）。下游 `mergePrNode` 对已 merge PR 幂等（already-merged→success→end），短路 PASS 端到端安全。可测试性：`opts.checkPrMerged` 注入（默认真 gh 调用）。

## 成功标准

- PR 已 merge → evaluate 短路 verdict=PASS，不 spawn evaluator（不 checkout 已删分支）。
- PR 未 merge → 不短路，照常进 evaluate。
- 幂等门优先：evaluate_verdict 已存在则直接返回，不查 PR 状态。
- 查询失败 fail-open（不误判 PASS）。
