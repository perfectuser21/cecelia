---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口

**范围**: packages/brain/src/impact-contract/diff-gate.js（三类分流 + reason_code 透传 + detail）、harness-gates.js（gateReceipt 透传 detail）、orchestrator/derive.js（新增 routeDeterministicImpactGate）、orchestrator/loop.js（retryable:false 走确定性出口）、routes/impact-contracts.js（blocked→409）、Brain semver 四处同步。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 按 reason_code 分派确定性 impact 结论（含 impact_anchor_missing 分支）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('blocked'))process.exit(1)"
  期望: exit 0
- [ ] [ARTIFACT] derive.js 导出 routeDeterministicImpactGate
  Test: node -e "import('./packages/brain/src/orchestrator/derive.js').then(m=>{if(typeof m.routeDeterministicImpactGate!=='function')process.exit(1)}).catch(()=>process.exit(1))"
  期望: exit 0
- [ ] [ARTIFACT] Brain semver 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: bash -c 'bash scripts/check-version-sync.sh'
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 把 impact_anchor_missing 折叠成 blocked/retryable=false 且 detail 带 unclaimed_files
  动作: 以 mock mapper 返回 `{freshness:{status:'unknown',reason_code:'impact_anchor_missing'},unclaimed_files:['DoD.md']}` 调 evaluateDiffGate
  预期观察: 返回 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']（旧代码返回 mapper_stale/retryable:true）
  等待预算: 0s
  留证: vitest --reporter=basic 输出末 5 行（含该用例 PASS）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js -t "impact_anchor_missing 折叠成 blocked" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: diff-gate 对真新鲜度 fact_snapshot_stale 仍维持 impact_unknown（回归保护，INV-1 重试身份不被误改）
  动作: 以 mock mapper 返回 `{freshness:{status:'stale',reason_code:'fact_snapshot_stale'}}` 调 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown'、reason='mapper_stale'、retryable=true（真基础设施可重试语义不动）
  等待预算: 0s
  留证: vitest --reporter=basic 输出（该回归用例 PASS）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js -t "fact_snapshot_stale 仍维持 impact_unknown" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: diff-gate 对未知/新增 reason_code 走 fail-closed（禁默认可重试）
  动作: 以 mock mapper 返回 `{freshness:{status:'unknown',reason_code:'some_future_unmapped_code'}}` 调 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown'、reason='mapper_contract_invalid'、retryable=false（未知 reason 一律 fail-closed）
  等待预算: 0s
  留证: vitest --reporter=basic 输出（该用例 PASS）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js -t "fail-closed mapper_contract_invalid" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: beforeEvaluate 的 gateReceipt 对 blocked 确定性结论透传 reason/retryable/detail
  动作: 注入 diffGate 返回 `{gate:'blocked',reason:'impact_anchor_missing',retryable:false,detail:{unclaimed_files:['DoD.md']}}`，调 createHarnessImpactGates().beforeEvaluate
  预期观察: receipt.reason='impact_anchor_missing'、receipt.retryable=false、receipt.detail.unclaimed_files=['DoD.md']（旧代码 gateReceipt 丢 detail）
  等待预算: 0s
  留证: vitest --reporter=basic 输出（该用例 PASS）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08162257-kernel-7589808e/tests/impact-gate-receipt-and-routing.test.js -t "gateReceipt 含 reason" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: routeDeterministicImpactGate 差异路由（anchor→generator-fix 一次→human_review；coverage→human_review）
  动作: 分别以 reason=impact_anchor_missing（decisionLog 空 / 含既往 generator-fix）与 reason=capability_assertion_coverage_missing 调 routeDeterministicImpactGate
  预期观察: 首遇 anchor → action='spawn:generator-fix' 且 detail.unclaimed_files 携带；已 fix 过 → 'wait:human_review'；coverage → 'wait:human_review'
  等待预算: 0s
  留证: vitest --reporter=basic 输出（三路由用例 PASS）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08162257-kernel-7589808e/tests/impact-gate-receipt-and-routing.test.js -t "routeDeterministicImpactGate" --reporter=basic'

- [ ] [BEHAVIOR] [L2] [接缝×2] B-06: 确定性 impact 闸落 orchestrator_decision_log 一行 deny:impact:impact_anchor_missing / retryable=false / unclaimed_files 非空（真 Postgres 写路径）
  动作: 对 scratch 库跑 ## E2E 验收 脚本（真跑 diff-gate 三类分流 + gateReceipt detail 透传 + appendHop 真写行）
  预期观察: orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'，detail.impact_gate.retryable=false，detail.impact_gate.detail.unclaimed_files 非空（旧代码落 deny:impact:mapper_stale/retryable:true）
  等待预算: 30s
  留证: psql 查询命中的 gate_verdict 值 + run_id（进 evidence 字段）
  Test: manual:bash -c 'cd /workspace && bash sprints/08162257-kernel-7589808e/e2e-verify.sh'

## INV 覆盖（历史约束三源 — 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 基础设施重试身份不被误改：真新鲜度 fact_snapshot_stale 仍 retryable:true（由 B-02 守卫）
  动作: 见 B-02
  预期观察: 见 B-02（retryable=true 保留）
  等待预算: 0s
  留证: 见 B-02
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js -t "fact_snapshot_stale 仍维持 impact_unknown" --reporter=basic'
- INV-2 Planner 分支：N/A（本单不涉及 planner workspace/checkout）
- INV-3 Fleet Brain URL 权威：N/A（本单不涉及 dispatcher/fleet worker 注入）
- INV-4 Evaluator 校验时钟：N/A（本单不改 validation_clock 逻辑）
