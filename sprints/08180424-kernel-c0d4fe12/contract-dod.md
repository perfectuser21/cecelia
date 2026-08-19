---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 Map 结论 fail-closed 出口

**范围**: `diff-gate.js` / `structure-gate.js` 对 `freshness.status !== 'fresh'` 分支的裁决（reason_code 透传 + status 分流 retryable）；`harness-gates.js` 确认 receipt 透传具体 reason_code。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 复现 + 回归合同测试文件存在且含 reason_code 透传/status 分流断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08180424-kernel-c0d4fe12/tests/impact-gate-reason-code.test.js','utf8');if(!c.includes('capability_not_in_active_projection')||!c.includes('fact_snapshot_stale')||!c.includes('mapper_stale'))process.exit(1)"

- [ ] [ARTIFACT] 存量 structure-gate stale 断言已从旧 bug 行为更新为透传具体 reason_code（不再断言 mapper_stale）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/structure-gate.test.js','utf8');if(/expect\(result\.reason\)\.toBe\('mapper_stale'\)/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 diff unknown → fail-closed 非重试且透传真码
  动作: 调用 evaluateDiffGate 注入 mapClient 返回 freshness={status:'unknown', reason_code:'capability_not_in_active_projection'}
  预期观察: 返回 gate='impact_unknown'、retryable=false、reason='capability_not_in_active_projection'（非 'mapper_stale'）
  等待预算: 0s
  留证: node 命令 stdout（OK + 结果对象）
  Test: manual:bash -c 'node --input-type=module -e '"'"'import{evaluateDiffGate}from"./packages/brain/src/impact-contract/diff-gate.js";const r=await evaluateDiffGate({taskId:"t",mapClient:async()=>({freshness:{status:"unknown",reason_code:"capability_not_in_active_projection"}})});if(r.gate!=="impact_unknown"||r.retryable!==false||r.reason!=="capability_not_in_active_projection"||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK",r.reason,r.retryable)'"'"''

- [ ] [BEHAVIOR] [L2] B-02: 瞬态 diff stale → 仍可重试且透传真码
  动作: 调用 evaluateDiffGate 注入 mapClient 返回 freshness={status:'stale', reason_code:'fact_snapshot_stale'}
  预期观察: 返回 retryable=true、reason='fact_snapshot_stale'（非 'mapper_stale'）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e '"'"'import{evaluateDiffGate}from"./packages/brain/src/impact-contract/diff-gate.js";const r=await evaluateDiffGate({taskId:"t",mapClient:async()=>({freshness:{status:"stale",reason_code:"fact_snapshot_stale"}})});if(r.retryable!==true||r.reason!=="fact_snapshot_stale"||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK",r.reason,r.retryable)'"'"''

- [ ] [BEHAVIOR] [L2] B-03: 确定性 structure unknown → blocked + 非重试 + 透传真码
  动作: 调用 evaluateStructureGate 注入 mapClient 返回 freshness={status:'unknown', reason_code:'impact_anchor_missing'}
  预期观察: 返回 gate='blocked'、retryable=false、reason='impact_anchor_missing'（非 'mapper_stale'）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e '"'"'import{evaluateStructureGate}from"./packages/brain/src/impact-contract/structure-gate.js";const r=await evaluateStructureGate({db:null,task:{id:"t",change_kind:"code_change"},contract:{task_id:"t",change_kind:"code_change",repo:"cecelia",base_revision:"a".repeat(40),affected_capabilities:[],required_assertions:[],contract_body:{affected_capabilities:[],required_assertions:[]}},mapClient:async()=>({freshness:{status:"unknown",reason_code:"impact_anchor_missing"}})});if(r.gate!=="blocked"||r.retryable!==false||r.reason!=="impact_anchor_missing"||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK",r.reason,r.retryable)'"'"''

- [ ] [BEHAVIOR] [L2] B-04: 瞬态 structure stale → blocked + 可重试 + 透传真码
  动作: 调用 evaluateStructureGate 注入 mapClient 返回 freshness={status:'stale', reason_code:'projection_revision_mismatch'}
  预期观察: 返回 gate='blocked'、retryable=true、reason='projection_revision_mismatch'（非 'mapper_stale'）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e '"'"'import{evaluateStructureGate}from"./packages/brain/src/impact-contract/structure-gate.js";const r=await evaluateStructureGate({db:null,task:{id:"t",change_kind:"code_change"},contract:{task_id:"t",change_kind:"code_change",repo:"cecelia",base_revision:"a".repeat(40),affected_capabilities:[],required_assertions:[],contract_body:{affected_capabilities:[],required_assertions:[]}},mapClient:async()=>({freshness:{status:"stale",reason_code:"projection_revision_mismatch"}})});if(r.gate!=="blocked"||r.retryable!==true||r.reason!=="projection_revision_mismatch"||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK",r.reason,r.retryable)'"'"''

- [ ] [BEHAVIOR] [L2] B-05: 边界 freshness=null → fail-closed 非重试（不静默判绿，不回退 mapper_stale）
  动作: 调用 evaluateDiffGate 注入 mapClient 返回 freshness=null
  预期观察: 返回 gate='impact_unknown'、retryable=false、reason!=='mapper_stale'
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e '"'"'import{evaluateDiffGate}from"./packages/brain/src/impact-contract/diff-gate.js";const r=await evaluateDiffGate({taskId:"t",mapClient:async()=>({freshness:null})});if(r.gate!=="impact_unknown"||r.retryable!==false||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK",r.reason,r.retryable)'"'"''

- [ ] [BEHAVIOR] [L2] B-06: 出口贯通 — 真实 diff-gate 抵达 harness-gates receipt，reason 具体化且 retryable 传播
  动作: 运行出口贯通合同测试（createHarnessImpactGates().beforeEvaluate 内真跑 evaluateDiffGate，注入 unknown freshness）
  预期观察: receipt.stage='diff'、receipt.reason='unsafe_assertion_ref'、receipt.retryable=false（不再 deny:impact:mapper_stale 空转）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 passed）
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/impact-gate-reason-code.test.js -t "出口贯通" --reporter=basic 2>&1 | grep -qE "1 passed|Tests +1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1: [不掩盖真因] 被改文件存量 brain 单元测试全绿（含更新后的 stale reason 回归断言）
  动作: 从 packages/brain 子 shell 跑三个 gate 存量单元测试
  预期观察: diff-gate/structure-gate/harness-gates 三文件测试全 passed，无 failed
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js --reporter=basic) 2>&1 | tail -6 | grep -q "failed" && { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2: [fail-closed] 复现合同测试整套转绿（确定性/瞬态/边界/出口贯通 7 例）
  动作: 从仓库根跑本 sprint 复现合同测试文件
  预期观察: 7 个用例全 passed（改前应 7 failed，改后 7 passed）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/impact-gate-reason-code.test.js --reporter=basic 2>&1 | tail -6 | grep -q "failed" && { echo FAIL; exit 1; }; echo OK'

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Diff gate 确定性 unknown fail-closed | `tests/impact-gate-reason-code.test.js` | 确定性 unknown 结论 fail-closed 且透传 reason_code | → FAIL（当前 reason=mapper_stale, retryable=true） |
| Diff gate 瞬态 stale 可重试 | `tests/impact-gate-reason-code.test.js` | 瞬态 stale 结论仍可重试且透传具体 reason_code | → FAIL（当前 reason=mapper_stale） |
| Diff gate 边界 null | `tests/impact-gate-reason-code.test.js` | freshness 缺失/为 null 视为不可判定 | → FAIL（当前 reason=mapper_stale, retryable=true） |
| Structure gate 确定性 unknown | `tests/impact-gate-reason-code.test.js` | 确定性 unknown 结论 fail-closed（retryable:false）且透传 reason_code | → FAIL（当前 retryable=true） |
| Structure gate 瞬态 stale | `tests/impact-gate-reason-code.test.js` | 瞬态 stale 结论 blocked 但 retryable:true 且透传 reason_code | → FAIL（当前 reason=mapper_stale） |
| Structure gate 无 reason_code | `tests/impact-gate-reason-code.test.js` | status 非 fresh 但缺 reason_code | → FAIL（当前 reason=mapper_stale） |
| 出口贯通 harness receipt | `tests/impact-gate-reason-code.test.js` | 确定性 unknown 经真实 diff-gate 抵达 receipt | → FAIL（当前 receipt.reason=mapper_stale, retryable=true） |
