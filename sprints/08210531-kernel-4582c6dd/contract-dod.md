---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并 fail-closed 出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js` step 3a（stale 折叠分支）透传 `reason_code` + 确定性 fail-closed 出口；回归测试。不改 loop.js（接收侧 retryable:false 消费为既有逻辑）、不改 Mapper。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 内置确定性 freshness reason_code 集合常量
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('projection_revision_mismatch')||!c.includes('impact_anchor_missing')||!c.includes('manifest_projection_mismatch'))process.exit(1)"

- [ ] [ARTIFACT] orchestrator 接收侧终态分类未回退（接缝 #1 logic-done-pending：真 orchestrator run 需真 Postgres，本 attempt postgres:false；此为既有未改逻辑的存在性守护）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('impactGateReceipt?.retryable === false')||!c.includes(\"'impact_contract_invalid'\"))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 确定性 reason_code (stale) → retryable:false 且透传真实 reason_code（不折叠 mapper_stale）
  动作: 以 `mapClient` 返回 `{freshness:{status:'stale',reason_code:'projection_revision_mismatch'}}`（及集合内其余 8 个 code）调用真实 `evaluateDiffGate`
  预期观察: 返回 `{gate:'impact_unknown', reason:'projection_revision_mismatch', reason_code:'projection_revision_mismatch', retryable:false}`，不再是 mapper_stale/retryable:true
  等待预算: 0s（纯函数同步返回）
  留证: vitest 输出末 5 行（含 test.each 9 例 PASS）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js -t 确定性'

- [ ] [BEHAVIOR] [L2] B-02: 确定性 reason_code (status=unknown) → retryable:false 透传
  动作: 以 `mapClient` 返回 `{freshness:{status:'unknown',reason_code:'impact_anchor_missing'}}` 调用 `evaluateDiffGate`
  预期观察: 返回 `{gate:'impact_unknown', reason:'impact_anchor_missing', reason_code:'impact_anchor_missing', retryable:false}`
  等待预算: 0s
  留证: vitest 输出（`status=unknown` 用例 PASS）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js -t unknown'

- [ ] [BEHAVIOR] [L2] B-03: 非确定性/缺失 reason_code → 保持 mapper_stale/retryable:true（不误杀可恢复重试）
  动作: 以 `mapClient` 返回 `{freshness:{status:'stale',reason_code:'fact_snapshot_stale'}}` 及 `{freshness:{status:'stale'}}`（无 reason_code）调用 `evaluateDiffGate`
  预期观察: 两例均返回 `{gate:'impact_unknown', reason:'mapper_stale', retryable:true}`
  等待预算: 0s
  留证: vitest 输出（两个"保持 mapper_stale"用例 PASS）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js -t "保持 mapper_stale"'

- [ ] [BEHAVIOR] [L2] B-04: packages/brain 既有 gate 回归全绿（wiring / mapper_unavailable / revision_mismatch / structure-gate 零回退）
  动作: 子 shell 切进 packages/brain，用包自身 vitest 配置跑 diff-gate + harness-gates + structure-gate 回归套件
  预期观察: 三个测试文件全部 PASS，既有 stale-无-reason_code merge 阻断断言（harness-gates.test.js line~409）不变
  等待预算: 0s
  留证: vitest 汇总行（Test Files passed / Tests passed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js ./src/impact-contract/__tests__/structure-gate.test.js)'

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] 确定性分支 gate 恒为 impact_unknown（绝不假绿 pass/extend）
  动作: 跑 sprint 合同测试，检查确定性 test.each 全部断言 `result.gate==='impact_unknown'`
  预期观察: 所有确定性用例 gate 均 impact_unknown，无一返回 pass/extend
  等待预算: 0s
  留证: vitest 输出（`gate).toBe('impact_unknown')` 断言全过）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js -t 确定性'

- [ ] [BEHAVIOR] [L2] INV-2 [有界终态] 确定性 Map 结论不得标 retryable:true（必须 fail-closed 终结）
  动作: 跑 sprint 合同测试，检查确定性用例 `result.retryable===false`
  预期观察: 全部确定性用例 retryable:false，无 retryable:true 空转口子
  等待预算: 0s
  留证: vitest 输出（`retryable).toBe(false)` 断言全过）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js -t 确定性'

- [ ] [BEHAVIOR] [L2] INV-3 [reason_code 透传] 已判定 reason_code 不得被折叠丢弃，receipt.reason 须为真实 code
  动作: 跑 sprint 合同测试，检查确定性用例 `result.reason===<真实code>` 且 `result.reason_code===<真实code>`
  预期观察: receipt 侧 reason/reason_code 均为真实 code（如 projection_revision_mismatch），非泛化 mapper_stale
  等待预算: 0s
  留证: vitest 输出（`reason).toBe(code)` + `reason_code).toBe(code)` 断言全过）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js -t 确定性'
