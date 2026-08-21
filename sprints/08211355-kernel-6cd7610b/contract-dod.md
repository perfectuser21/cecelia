---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口（r37）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（freshness.status !== 'fresh' 分支）——透传 `mapperResult.freshness.reason_code`、按 `reason_code == null` 决定 retryable、确定性结论 fail-closed。不改其余分支、不改 map-client、不改调度重排器。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 分支透传 reason_code（源码含透传逻辑，非恒定 mapper_stale）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('reason_code')||!/freshness(\?\.|\.)reason_code/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 冻结回归测试文件存在且覆盖 evaluateDiffGate
  Test: node -e "const c=require('fs').readFileSync('sprints/08211355-kernel-6cd7610b/tests/diff-gate-reason-code.test.js','utf8');if(!c.includes('evaluateDiffGate')||!c.includes('reason_code'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous 模式测真实模块函数）

- [ ] [BEHAVIOR] [L2] B-01: stale + 确定性 reason_code → 透传该 reason_code 且 fail-closed（retryable=false）
  动作: 以 mapClient 返回 `freshness={status:'stale',reason_code:'MAP_DELETED_NODE'}` 调 evaluateDiffGate
  预期观察: 返回对象 `reason_code==='MAP_DELETED_NODE'`（非恒定 'mapper_stale'）且 `retryable===false`、`gate==='impact_unknown'`
  等待预算: 0s
  留证: node 命令 stdout（OK 行）+ exit code
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base123',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',headRevision:'h',repo:'cecelia',changedFiles:['x'],mapClient:async()=>({freshness:{status:'stale',reason_code:'MAP_DELETED_NODE'},affected_nodes:[],required_assertions:[]})}); if(r.gate!=='impact_unknown'||r.reason_code!=='MAP_DELETED_NODE'||r.retryable!==false){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK B-01')"
  期望: OK B-01

- [ ] [BEHAVIOR] [L2] B-02: unknown 无 reason_code → 短暂不可判定，retryable=true
  动作: 以 mapClient 返回 `freshness={status:'unknown',reason_code:null}` 调 evaluateDiffGate
  预期观察: 返回对象 `reason_code===null` 且 `retryable===true`、`gate==='impact_unknown'`（允许调度重排）
  等待预算: 0s
  留证: node 命令 stdout（OK 行）+ exit code
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base123',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',headRevision:'h',repo:'cecelia',changedFiles:['x'],mapClient:async()=>({freshness:{status:'unknown',reason_code:null},affected_nodes:[],required_assertions:[]})}); if(r.gate!=='impact_unknown'||r.reason_code!==null||r.retryable!==true){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK B-02')"
  期望: OK B-02

- [ ] [BEHAVIOR] [L2] B-03: freshness 缺失 → 终态可观察不假绿（gate=impact_unknown，非 pass）
  动作: 以 mapClient 返回无 `freshness` 字段的结果调 evaluateDiffGate
  预期观察: 返回对象 `gate==='impact_unknown'` 且 `verdict===undefined`（未被误判为 pass/extend）、`reason_code===null`
  等待预算: 0s
  留证: node 命令 stdout（OK 行）+ exit code
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base123',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',headRevision:'h',repo:'cecelia',changedFiles:['x'],mapClient:async()=>({affected_nodes:[],required_assertions:[]})}); if(r.gate!=='impact_unknown'||r.verdict!==undefined||r.reason_code!==null){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK B-03')"
  期望: OK B-03

- [ ] [BEHAVIOR] [L2] B-04: reason_code 为下游未知的新枚举值 → 原样透传不崩溃且 fail-closed
  动作: 以 mapClient 返回 `freshness={status:'stale',reason_code:'BRAND_NEW_ENUM_9999'}` 调 evaluateDiffGate
  预期观察: 无 throw，返回对象 `reason_code==='BRAND_NEW_ENUM_9999'` 且 `retryable===false`（对齐 status 枚举全仓库对账铁律，未知码透传不崩）
  等待预算: 0s
  留证: node 命令 stdout（OK 行）+ exit code
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base123',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',headRevision:'h',repo:'cecelia',changedFiles:['x'],mapClient:async()=>({freshness:{status:'stale',reason_code:'BRAND_NEW_ENUM_9999'},affected_nodes:[],required_assertions:[]})}); if(r.reason_code!=='BRAND_NEW_ENUM_9999'||r.retryable!==false){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK B-04')"
  期望: OK B-04

- [ ] [BEHAVIOR] [L2] INV-语义不分叉: 冻结 sprint 回归 + 模块回归全绿，非 fresh 分支细分 reason_code/retryable 后既有 fail-closed 语义（revision_mismatch 等 20 例）不回退
  动作: 从仓库根跑 sprint 冻结测试，并子 shell 切进 packages/brain 跑模块回归
  预期观察: sprint 4 用例全绿；模块测试 24 用例全绿（既有 20 + 新增 4），无既有断言回退
  等待预算: 0s
  留证: 两次 vitest stdout 末尾汇总行
  Test: manual:bash -c 'npx vitest run --no-cache "sprints/08211355-kernel-6cd7610b/tests/diff-gate-reason-code.test.js" && ( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js )'
  期望: 两个 vitest 进程 exit 0
