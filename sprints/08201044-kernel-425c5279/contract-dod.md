---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 unknown fail-closed

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 非 fresh 分支（步骤 3a，当前 L202-208）——按 `freshness.status` 做 stale(瞬态,retryable) vs unknown/缺失(确定性,fail-closed) 二分并透传 `reason_code`。既有 revision/digest/mapper_unavailable/db_unavailable/contract_missing 出口不改。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 非 fresh 分支已改为按 freshness.status 二分（不再无条件 mapper_stale）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8'); const b=c.slice(c.indexOf('步骤 3')); if(!/freshness\.status\s*===\s*'stale'/.test(c)){process.exit(1)} if(!/mapper_unknown/.test(c)){process.exit(1)} if(!/reason_code/.test(b)){process.exit(1)}"
  期望: exit 0（源码含 status==='stale' 二分、确定性兜底码 mapper_unknown、reason_code 透传）

## BEHAVIOR 条目（五行剧本，内嵌单行 manual: 命令；均 [L2] 服务端真验——真跑被改函数，无替身）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 unknown → fail-closed（retryable:false）+ 透传具体 reason_code（非 mapper_stale）
  动作: 以 mapClient 注入 freshness={status:'unknown', reason_code:'graph_projection_revision_mismatch'} 调真实 evaluateDiffGate
  预期观察: 返回 gate=impact_unknown、retryable=false、reason=graph_projection_revision_mismatch、reason_code 同码，且 reason !== 'mapper_stale'
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"graph_projection_revision_mismatch\"}})}); if(!(r.gate===\"impact_unknown\"&&r.retryable===false&&r.reason===\"graph_projection_revision_mismatch\"&&r.reason_code===\"graph_projection_revision_mismatch\"&&r.reason!==\"mapper_stale\")){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)} console.log(\"OK\",JSON.stringify(r))"'

- [ ] [BEHAVIOR] [L2] B-02: 瞬态 stale → retryable:true + 透传具体 reason_code
  动作: 以 mapClient 注入 freshness={status:'stale', reason_code:'fact_snapshot_stale'} 调真实 evaluateDiffGate
  预期观察: 返回 gate=impact_unknown、retryable=true、reason=fact_snapshot_stale、reason_code=fact_snapshot_stale
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"}})}); if(!(r.gate===\"impact_unknown\"&&r.retryable===true&&r.reason===\"fact_snapshot_stale\"&&r.reason_code===\"fact_snapshot_stale\")){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)} console.log(\"OK\",JSON.stringify(r))"'

- [ ] [BEHAVIOR] [L2] B-03: 边界兜底 — 缺 reason_code / 缺 freshness，确定性绝不回退 mapper_stale
  动作: 分别注入 freshness={status:'unknown'}（无码）、freshness=null（缺失）、freshness={status:'stale'}（无码）调真实 evaluateDiffGate
  预期观察: unknown 无码→retryable:false/reason=mapper_unknown（非 mapper_stale）；freshness 缺失→retryable:false/gate=impact_unknown/非 mapper_stale（绝不 pass）；stale 无码→retryable:true/reason=mapper_stale（瞬态兜底合法）
  等待预算: 0s
  留证: node 断言 stdout（OK）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const u=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\"}})}); const m=await evaluateDiffGate({mapClient:async()=>({freshness:null})}); const s=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\"}})}); const okU=u.retryable===false&&u.reason===\"mapper_unknown\"&&u.reason!==\"mapper_stale\"; const okM=m.gate===\"impact_unknown\"&&m.retryable===false&&m.reason!==\"mapper_stale\"; const okS=s.retryable===true&&s.reason===\"mapper_stale\"; if(!(okU&&okM&&okS)){console.error(\"FAIL\",JSON.stringify({u,m,s}));process.exit(1)} console.log(\"OK\")"'

- [ ] [BEHAVIOR] [L2] B-04: 非 fresh 恒入 impact_unknown 分支（不进 pass/extend/drift 对账）
  动作: 以 mapClient 注入 freshness={status:'unknown', reason_code:'impact_anchor_missing'} 调真实 evaluateDiffGate
  预期观察: 返回 gate=impact_unknown（Step1 入口约束）
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"}})}); if(r.gate!==\"impact_unknown\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)} console.log(\"OK\",JSON.stringify(r))"'

- [ ] [BEHAVIOR] [L2] B-05: orchestrator gateVerdict 携带具体 code 且确定性 unknown 不进重派（run 收敛）[接缝×2]
  动作: 跑 packages/brain 自身 vitest 的 orchestrator loop 用例（Diff Gate 相关），验证 loop 由 impactGateReceipt.reason 构造 gateVerdict 并对 retryable:false 走收敛
  预期观察: loop.test.js「Diff Gate」相关用例全过，确定性场景 gateVerdict !== 'deny:impact:mapper_stale'
  等待预算: 120s
  留证: vitest 输出末尾（含 passed 计数）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "Diff Gate" 2>&1 | tail -10 | grep -Eq "[1-9][0-9]* passed" || { echo FAIL; exit 1; }'

## Invariant 铁律映射（历史约束三源 — 逐条 INV 覆盖或 N/A）

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] 任何不可判定情形绝不 pass，确定性 unknown 必 retryable:false 收敛（不得靠 retryable 遮蔽）
  动作: 注入 unknown（有码/无码）与 freshness=null 三种确定性场景调真实 evaluateDiffGate
  预期观察: 三者 gate 均为 impact_unknown（绝非 pass/extend），retryable 均为 false
  等待预算: 0s
  留证: node 断言 stdout（OK）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const cs=[{freshness:{status:\"unknown\",reason_code:\"capability_not_in_active_projection\"}},{freshness:{status:\"unknown\"}},{freshness:null}]; for(const c of cs){const r=await evaluateDiffGate({mapClient:async()=>c}); if(!(r.gate===\"impact_unknown\"&&r.retryable===false)){console.error(\"FAIL\",JSON.stringify({c,r}));process.exit(1)}} console.log(\"OK\")"'

- [ ] [BEHAVIOR] [L2] INV-2 [透传真因] 非 fresh 且有 reason_code 时 reason 必等于该 code；确定性出口绝不折叠成裸 mapper_stale
  动作: 注入 stale+码 与 unknown+码 两场景调真实 evaluateDiffGate
  预期观察: reason===reason_code===注入的具体 code；unknown 场景 reason!=='mapper_stale'
  等待预算: 0s
  留证: node 断言 stdout（OK）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const st=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"projection_revision_mismatch\"}})}); const un=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"unsafe_assertion_ref\"}})}); if(!(st.reason===\"projection_revision_mismatch\"&&st.reason_code===\"projection_revision_mismatch\"&&un.reason===\"unsafe_assertion_ref\"&&un.reason_code===\"unsafe_assertion_ref\"&&un.reason!==\"mapper_stale\")){console.error(\"FAIL\",JSON.stringify({st,un}));process.exit(1)} console.log(\"OK\")"'

- INV-3 [原始归因] nightly-red / 失败诊断贴原始 stdout — N/A：本 sprint 不触及 nightly-red / 诊断截断模块；透传 reason_code 反而增强 orchestrator gateVerdict 与断言明细（1.273.96）的可归因性，无破坏面。

## 零回归条目（既有出口语义不变）

- [ ] [BEHAVIOR] [L2] B-06: fresh 且 revision 不符路径 reason 仍为 revision_mismatch（未被本改动波及）
  动作: 注入 freshness={status:'fresh'} + fact_revisions 与合同 base_revision 不符调真实 evaluateDiffGate（带 db=null，contract 走 mapClient 复算路径不适用，改用 diff-gate.test.js 既有回归覆盖）
  预期观察: packages/brain 既有 diff-gate.test.js 全绿（既有 impact_unknown 回归未回退）
  等待预算: 120s
  留证: vitest 输出末尾（含 passed 计数）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | tail -10 | grep -Eq "[1-9][0-9]* passed" || { echo FAIL; exit 1; }'
