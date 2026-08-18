---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 透传 `freshness.reason_code` + 按确定性/终态判 `retryable`；保证经 `harness-gates.gateReceipt` 抵达 loop；新增 failing→green 回归。structure-gate / merge-gate 其它分支、Mapper freshness 判定、loop failure_class 语义均不动。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 透传 reason_code 并定义终态码集合
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('TERMINAL_FRESHNESS_REASON_CODES')||!c.includes('reason_code'))process.exit(1)"

- [ ] [ARTIFACT] 永久回归断言落 brain __tests__（brain-ci 常驻）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('reason_code')||!(c.includes('unknown')||c.includes('impact_anchor_missing')))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令；真实 evaluateDiffGate / gateReceipt，无 Postgres）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 unknown 结论透传 reason_code + fail-closed（retryable=false）
  动作: 调真实 evaluateDiffGate，注入 mapClient 返回 freshness={status:'unknown',reason_code:'impact_anchor_missing'}
  预期观察: 返回 gate=impact_unknown、reason_code='impact_anchor_missing'、retryable=false（不再折叠成 mapper_stale/retryable:true）
  等待预算: 0s
  留证: node 命令 stdout（含 OK + 返回体 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async () => ({ freshness:{status:"unknown",reason_code:"impact_anchor_missing"}, affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) }); if (r.gate!=="impact_unknown"||r.reason_code!=="impact_anchor_missing"||r.retryable!==false){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK",JSON.stringify(r));'"'"''
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: 瞬态 stale 且 reason_code=null 保留 mapper_stale/retryable=true（不误判假 block）
  动作: 调真实 evaluateDiffGate，注入 mapClient 返回 freshness={status:'stale',reason_code:null}
  预期观察: 返回 reason='mapper_stale'、reason_code=null、retryable=true
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async () => ({ freshness:{status:"stale",reason_code:null}, affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) }); if (r.reason!=="mapper_stale"||r.reason_code!==null||r.retryable!==true){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK",JSON.stringify(r));'"'"''
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: 瞬态 stale 带自愈 reason_code → 透传 code 且 retryable=true
  动作: 调真实 evaluateDiffGate，注入 mapClient 返回 freshness={status:'stale',reason_code:'fact_snapshot_stale'}
  预期观察: 返回 reason_code='fact_snapshot_stale'、reason='fact_snapshot_stale'、retryable=true（观测增强，重试语义不变）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async () => ({ freshness:{status:"stale",reason_code:"fact_snapshot_stale"}, affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) }); if (r.reason_code!=="fact_snapshot_stale"||r.retryable!==true){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK",JSON.stringify(r));'"'"''
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: 终态码集合成员判 fail-closed（capability_not_in_active_projection）
  动作: 调真实 evaluateDiffGate，注入 mapClient 返回 freshness={status:'unknown',reason_code:'capability_not_in_active_projection'}
  预期观察: 返回 reason_code='capability_not_in_active_projection'、retryable=false
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async () => ({ freshness:{status:"unknown",reason_code:"capability_not_in_active_projection"}, affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) }); if (r.reason_code!=="capability_not_in_active_projection"||r.retryable!==false){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK",JSON.stringify(r));'"'"''
  期望: OK

- [ ] [BEHAVIOR] [L2] B-05: reason_code/retryable 经真实 gateReceipt 抵达（禁 mock 接力边）[接缝×2]
  动作: 经真实 createHarnessImpactGates().beforeEvaluate（注入真实 evaluateDiffGate + mapClient unknown 结论 + fake 合同 db）跑真实 gateReceipt
  预期观察: receipt.gate=impact_unknown、receipt.reason='impact_anchor_missing'、receipt.retryable=false（loop.js:1542 据此判 impact_contract_invalid 终态）
  等待预算: 0s
  留证: sprint 测试 B-05 输出（根 vitest）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-fail-closed.test.ts 2>&1 | grep -Eq "5 (tests|passed)" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-fail-closed: Mapper 不可判定绝不假绿（unknown 结论不得进 pass/extend）
  动作: 对 status=unknown 结论断言 gate 恒为 impact_unknown（绝不 pass/extend）
  预期观察: gate=impact_unknown 且 verdict 未被设为 pass/extend
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async () => ({ freshness:{status:"unknown",reason_code:"impact_anchor_missing"}, affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) }); if (r.gate!=="impact_unknown"||["pass","extend"].includes(r.verdict)){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK",JSON.stringify(r));'"'"''
  期望: OK

> INV-nightly-red: N/A — 本 sprint 不触及 nightly job 输出/截断逻辑（铁律覆盖 CI 输出模块，非本单改动面）。
> INV-fail-closed 由上方 B-05/INV-fail-closed BEHAVIOR 条目覆盖。

- [ ] [BEHAVIOR] [L2] REG: 既有 diff-gate 回归全绿（pass/extend/drift/revision_mismatch 等不回退）
  动作: 跑 brain 层 diff-gate 全量测试
  预期观察: 全部通过，无既有断言回退
  等待预算: 0s
  留证: brain vitest 输出末行
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | grep -Eq "Test Files.*passed" || { echo FAIL; exit 1; }; echo OK'
