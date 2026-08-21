contract_branch: cp-harness-propose-r1-949b0c61-rd2334022-a4
sprint_dir: sprints/08211839-kernel-949b0c61

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口（r39）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` step 3a 折叠点 + `structure-gate.js` 同款折叠点（`buildBlockedResult('mapper_stale',503)`）透传 `freshness.reason_code`，按确定性白名单决定 `retryable`；新建共享白名单 `freshness-codes.js`；回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 共享确定性白名单常量 `freshness-codes.js` 存在并导出 helper
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/freshness-codes.js','utf8');if(!c.includes('DETERMINISTIC_FRESHNESS_REASON_CODES')||!c.includes('isDeterministicFreshnessReason')||!c.includes('impact_anchor_missing'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] diff-gate.js step 3a 不再硬编码折叠 mapper_stale（引入共享白名单）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('freshness-codes.js')||!c.includes('reason_code'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令；autonomous 同步观察，等待预算 0s）

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 确定性结论 impact_anchor_missing 透传 reason_code 且 retryable:false（不再折叠 mapper_stale）
  动作: 用 db:null + mapClient 注入 freshness{status:unknown,reason_code:impact_anchor_missing}，直调真实 evaluateDiffGate
  预期观察: 返回 reason==reason_code=='impact_anchor_missing' 且 retryable===false（fail-closed 出口）
  等待预算: 0s
  留证: node 命令 stdout（OK / FAIL+JSON）
  Test: manual:bash -c 'node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const r=await g({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]})});if(r.reason!==\"impact_anchor_missing\"||r.reason_code!==\"impact_anchor_missing\"||r.retryable!==false){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: diff-gate 瞬态结论 fact_snapshot_stale 透传 reason_code 且保持 retryable:true
  动作: mapClient 注入 freshness{status:stale,reason_code:fact_snapshot_stale}，直调 evaluateDiffGate
  预期观察: 返回 reason=='fact_snapshot_stale' 且 retryable===true（仍可重试，不误 fail-closed）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const r=await g({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"},affected_nodes:[],required_assertions:[]})});if(r.reason!==\"fact_snapshot_stale\"||r.reason_code!==\"fact_snapshot_stale\"||r.retryable!==true){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: diff-gate reason_code 缺失/null 且 status≠fresh 保守回退 mapper_stale + retryable:true（不假绿）
  动作: mapClient 注入 freshness{status:stale,reason_code:null}，直调 evaluateDiffGate
  预期观察: 返回 reason=='mapper_stale' 且 retryable===true（保守回退，不误终止）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const r=await g({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"stale\",reason_code:null},affected_nodes:[],required_assertions:[]})});if(r.reason!==\"mapper_stale\"||r.retryable!==true){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: structure-gate 确定性结论 impact_anchor_missing 透传 reason_code 且 retryable:false（同款折叠点修复）
  动作: db:null + contract + mapClient 注入 freshness{status:unknown,reason_code:impact_anchor_missing}，直调真实 evaluateStructureGate
  预期观察: 返回 gate=='blocked'，reason==reason_code=='impact_anchor_missing' 且 retryable===false
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e "import{evaluateStructureGate as g}from\"./packages/brain/src/impact-contract/structure-gate.js\";const r=await g({db:null,task:{id:\"t\",change_kind:\"bugfix\"},contract:{task_id:\"t\",change_kind:\"bugfix\",repo:\"cecelia\",base_revision:\"abc\",affected_capabilities:[{capability_id:\"c1\"}],required_assertions:[],contract_body:{affected_capabilities:[{capability_id:\"c1\"}],required_assertions:[]}},mapClient:async()=>({fact_revisions:{cecelia:\"abc\"},freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]})});if(r.gate!==\"blocked\"||r.reason!==\"impact_anchor_missing\"||r.reason_code!==\"impact_anchor_missing\"||r.retryable!==false){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-05: structure-gate 瞬态结论 fact_snapshot_stale 透传 reason_code 且保持 retryable:true
  动作: contract + mapClient 注入 freshness{status:stale,reason_code:fact_snapshot_stale}，直调 evaluateStructureGate
  预期观察: 返回 gate=='blocked'，reason=='fact_snapshot_stale' 且 retryable===true
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e "import{evaluateStructureGate as g}from\"./packages/brain/src/impact-contract/structure-gate.js\";const r=await g({db:null,task:{id:\"t\",change_kind:\"bugfix\"},contract:{task_id:\"t\",change_kind:\"bugfix\",repo:\"cecelia\",base_revision:\"abc\",affected_capabilities:[{capability_id:\"c1\"}],required_assertions:[],contract_body:{affected_capabilities:[{capability_id:\"c1\"}],required_assertions:[]}},mapClient:async()=>({fact_revisions:{cecelia:\"abc\"},freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"},affected_nodes:[],required_assertions:[]})});if(r.gate!==\"blocked\"||r.reason!==\"fact_snapshot_stale\"||r.retryable!==true){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-1: 同一确定性结论重复进 diff-gate 判定稳定不震荡（幂等 NFR；retryable 恒 false）
  动作: 用同一 mapClient（确定性 impact_anchor_missing）连续两次调用 evaluateDiffGate
  预期观察: 两次 reason_code 与 retryable 全等，且 retryable===false（不在 retryable 与否间震荡）
  等待预算: 0s
  留证: node 命令 stdout
  Test: manual:bash -c 'node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const c=async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]});const a=await g({db:null,taskId:\"t\",mapClient:c});const b=await g({db:null,taskId:\"t\",mapClient:c});if(a.reason_code!==b.reason_code||a.retryable!==b.retryable||b.retryable!==false){console.error(\"FAIL\",JSON.stringify({a,b}));process.exit(1)}console.log(\"OK\")"'
  期望: OK
