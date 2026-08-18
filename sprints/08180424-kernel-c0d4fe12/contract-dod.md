---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 stale fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a freshness 分支——透传 `reason_code` + 确定性 stale `retryable:false` 出口；对应回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 分支透传 reason_code 且 stale 走 retryable:false
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('reason_code')||!/retryable:\s*false/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] sprint 回归测试文件存在且覆盖 stale/unknown 分流
  Test: node -e "const c=require('fs').readFileSync('sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.js','utf8');if(!c.includes('retryable')||!c.includes('reason_code'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — autonomous / 进程内纯函数，node 直验真实 evaluateDiffGate）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 stale + reason_code → gate=impact_unknown, reason_code 透传, retryable=false
  动作: 调用真实 evaluateDiffGate，注入 mapClient 返回 freshness={status:'stale', reason_code:'MAP_PROJECTION_STALE'}
  预期观察: 返回 {gate:'impact_unknown', reason_code:'MAP_PROJECTION_STALE', retryable:false}
  等待预算: 0s
  留证: node 命令 stdout（OK stale）+ 非零 exit 即 FAIL
  Test: manual:bash -c 'node --input-type=module -e "import { evaluateDiffGate } from \"./packages/brain/src/impact-contract/diff-gate.js\"; const db={query:async()=>({rows:[{id:\"c\",repo:\"cecelia\",change_kind:\"bugfix\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"MAP_PROJECTION_STALE\"}})}); if(r.gate!==\"impact_unknown\"||r.reason_code!==\"MAP_PROJECTION_STALE\"||r.retryable!==false){console.error(\"FAIL\",JSON.stringify(r));process.exit(1);} console.log(\"OK stale\");"'
  期望: OK stale

- [ ] [BEHAVIOR] [L2] B-02: 边界 stale 但 reason_code 缺失 → retryable=false, reason_code=null（不回退无限重试）
  动作: 调用 evaluateDiffGate，注入 freshness={status:'stale'}（无 reason_code）
  预期观察: 返回 retryable=false 且 reason_code=null
  等待预算: 0s
  留证: node 命令 stdout（OK stale-null）
  Test: manual:bash -c 'node --input-type=module -e "import { evaluateDiffGate } from \"./packages/brain/src/impact-contract/diff-gate.js\"; const db={query:async()=>({rows:[{id:\"c\",repo:\"cecelia\",change_kind:\"bugfix\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({freshness:{status:\"stale\"}})}); if(r.retryable!==false||r.reason_code!==null){console.error(\"FAIL\",JSON.stringify(r));process.exit(1);} console.log(\"OK stale-null\");"'
  期望: OK stale-null

- [ ] [BEHAVIOR] [L2] B-03: unknown 瞬时态 → retryable=true 且透传 reason_code
  动作: 调用 evaluateDiffGate，注入 freshness={status:'unknown', reason_code:'MAP_INDETERMINATE'}
  预期观察: 返回 retryable=true 且 reason_code='MAP_INDETERMINATE'
  等待预算: 0s
  留证: node 命令 stdout（OK unknown）
  Test: manual:bash -c 'node --input-type=module -e "import { evaluateDiffGate } from \"./packages/brain/src/impact-contract/diff-gate.js\"; const db={query:async()=>({rows:[{id:\"c\",repo:\"cecelia\",change_kind:\"bugfix\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"MAP_INDETERMINATE\"}})}); if(r.retryable!==true||r.reason_code!==\"MAP_INDETERMINATE\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1);} console.log(\"OK unknown\");"'
  期望: OK unknown

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] 非 fresh 情形仍返回 gate=impact_unknown，绝不落入 pass/extend/drift（不假绿）
  动作: 注入 stale freshness，检查 gate 值不是 pass/extend/drift
  预期观察: gate==='impact_unknown'（保持 fail-closed）
  等待预算: 0s
  留证: node 命令 stdout（OK inv-fail-closed）
  Test: manual:bash -c 'node --input-type=module -e "import { evaluateDiffGate } from \"./packages/brain/src/impact-contract/diff-gate.js\"; const db={query:async()=>({rows:[{id:\"c\",repo:\"cecelia\",change_kind:\"bugfix\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"X\"}})}); if(r.gate!==\"impact_unknown\"||[\"pass\",\"extend\",\"drift\"].includes(r.gate)){console.error(\"FAIL\",JSON.stringify(r));process.exit(1);} console.log(\"OK inv-fail-closed\");"'
  期望: OK inv-fail-closed

- [ ] [BEHAVIOR] [L2] INV-2 [不冤杀瞬时态] freshness.status='unknown' 必须 retryable=true（只有确定性结论才可 fail-closed）
  动作: 注入 unknown freshness，检查 retryable 保持 true
  预期观察: retryable===true（瞬时态未被误杀）
  等待预算: 0s
  留证: node 命令 stdout（OK inv-transient）
  Test: manual:bash -c 'node --input-type=module -e "import { evaluateDiffGate } from \"./packages/brain/src/impact-contract/diff-gate.js\"; const db={query:async()=>({rows:[{id:\"c\",repo:\"cecelia\",change_kind:\"bugfix\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({freshness:{status:\"unknown\"}})}); if(r.retryable!==true){console.error(\"FAIL\",JSON.stringify(r));process.exit(1);} console.log(\"OK inv-transient\");"'
  期望: OK inv-transient

- [ ] [BEHAVIOR] [L2] B-04: sprint 新测试 + 既有 diff-gate.test.js 回归全绿（不回退 fresh/drift/extend/mapper 异常）
  动作: 跑 sprint 回归测试与既有 diff-gate.test.js（既有用例从 packages/brain 子 shell 跑）
  预期观察: 两套测试全部 pass，无既有用例回退
  等待预算: 0s
  留证: vitest 汇总输出末尾（Test Files passed）
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.js --reporter=basic && (cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=basic)'
  期望: 两套测试均 exit 0 全绿
