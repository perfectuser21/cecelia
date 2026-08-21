contract_branch: cp-harness-propose-r1-d133c55c-r5bfc1af9-a4
sprint_dir: sprints/08220132-kernel-d133c55c

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并按确定性 fail-closed

**范围**: `evaluateDiffGate` 第 3a 步透传 `freshness.reason_code` + 按瞬时白名单/确定性/未知码分类 `retryable`；`gateReceipt` 导出并透传具体 reason_code。仅改 `packages/brain/src/impact-contract/`。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结合同测试文件存在且含 6 条 test()
  Test: node -e "const c=require('fs').readFileSync('sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts','utf8');const n=(c.match(/\btest\(/g)||[]).length;if(n<6){console.error('only',n,'tests');process.exit(1)};if(!c.includes('capability_not_in_active_projection'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，Golden Path 1:1 映射）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 reason_code 走 fail-closed
  动作: 以 mapClient 注入 `freshness={status:'stale',reason_code:'capability_not_in_active_projection'}` 调真实 evaluateDiffGate（db:null）
  预期观察: 返回 `{gate:'impact_unknown', reason:'capability_not_in_active_projection', retryable:false}`（reason 为具体码，非裸 mapper_stale）
  等待预算: 0s
  留证: node 断言 stdout（含 JSON 返回）
  Test: manual:bash -c 'node --input-type=module -e "const m=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/diff-gate.js\");const r=await m.evaluateDiffGate({db:null,taskId:\"t\",headRevision:\"h\",changedFiles:[],mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"capability_not_in_active_projection\"}})});console.log(JSON.stringify(r));if(r.reason!==\"capability_not_in_active_projection\"||r.retryable!==false){process.exit(1)}process.exit(0)"'

- [ ] [BEHAVIOR] [L2] B-02: 瞬时白名单 fact_snapshot_stale 保留重试
  动作: 注入 `freshness={status:'stale',reason_code:'fact_snapshot_stale'}` 调 evaluateDiffGate
  预期观察: 返回 `reason:'fact_snapshot_stale'` 且 `retryable:true`
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node --input-type=module -e "const m=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/diff-gate.js\");const r=await m.evaluateDiffGate({db:null,taskId:\"t\",headRevision:\"h\",changedFiles:[],mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"}})});console.log(JSON.stringify(r));if(r.reason!==\"fact_snapshot_stale\"||r.retryable!==true){process.exit(1)}process.exit(0)"'

- [ ] [BEHAVIOR] [L2] B-03: 瞬时白名单 projection_revision_missing 保留重试
  动作: 注入 `freshness={status:'stale',reason_code:'projection_revision_missing'}` 调 evaluateDiffGate
  预期观察: 返回 `reason:'projection_revision_missing'` 且 `retryable:true`
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node --input-type=module -e "const m=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/diff-gate.js\");const r=await m.evaluateDiffGate({db:null,taskId:\"t\",headRevision:\"h\",changedFiles:[],mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"projection_revision_missing\"}})});console.log(JSON.stringify(r));if(r.reason!==\"projection_revision_missing\"||r.retryable!==true){process.exit(1)}process.exit(0)"'

- [ ] [BEHAVIOR] [L2] B-04: freshness 缺失（null）保留重试
  动作: 注入 mapClient 返回不含 freshness 的对象 `{affected_nodes:[]}` 调 evaluateDiffGate
  预期观察: 返回 `gate:'impact_unknown'` 且 `retryable:true`（视为 Mapper 未产出的瞬时态）
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node --input-type=module -e "const m=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/diff-gate.js\");const r=await m.evaluateDiffGate({db:null,taskId:\"t\",headRevision:\"h\",changedFiles:[],mapClient:async()=>({affected_nodes:[]})});console.log(JSON.stringify(r));if(r.gate!==\"impact_unknown\"||r.retryable!==true){process.exit(1)}process.exit(0)"'

- [ ] [BEHAVIOR] [L2] B-05: 未知/未来 reason_code 默认 fail-closed
  动作: 注入 `freshness={status:'stale',reason_code:'some_future_unknown_code'}` 调 evaluateDiffGate
  预期观察: 白名单外未知码 → `retryable:false`（fail-closed），`reason` 透传该具体码
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node --input-type=module -e "const m=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/diff-gate.js\");const r=await m.evaluateDiffGate({db:null,taskId:\"t\",headRevision:\"h\",changedFiles:[],mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"some_future_unknown_code\"}})});console.log(JSON.stringify(r));if(r.retryable!==false||r.reason!==\"some_future_unknown_code\"){process.exit(1)}process.exit(0)"'

- [ ] [BEHAVIOR] [L2] B-06: gateReceipt 透传具体 reason_code（deny 标签非裸 mapper_stale）
  动作: 调真实 gateReceipt('diff', 确定性结果) 构造 deny 收据
  预期观察: `receipt.reason === 'capability_not_in_active_projection'` 且 `!= 'mapper_stale'`
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node --input-type=module -e "const h=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/harness-gates.js\");if(typeof h.gateReceipt!==\"function\"){console.error(\"gateReceipt not exported\");process.exit(1)}const rc=h.gateReceipt(\"diff\",{gate:\"impact_unknown\",reason:\"capability_not_in_active_projection\",retryable:false});console.log(JSON.stringify(rc));if(rc.reason!==\"capability_not_in_active_projection\"||rc.reason===\"mapper_stale\"){process.exit(1)}process.exit(0)"'

- [ ] [BEHAVIOR] [L2] INV-1: 既有 fail-closed 分支不回退（3a 仍 impact_unknown，无新增放行）
  动作: 注入非 fresh freshness 复算，断言 gate 恒为 impact_unknown（绝不 pass/extend）
  预期观察: 任何非 fresh 输入 → `gate:'impact_unknown'`（fail-closed 铁律不破）
  等待预算: 0s
  留证: node 断言 stdout（两个用例 gate 均 impact_unknown）
  Test: manual:bash -c 'node --input-type=module -e "const m=await import(\"file://\"+process.cwd()+\"/packages/brain/src/impact-contract/diff-gate.js\");const c=(rc)=>m.evaluateDiffGate({db:null,taskId:\"t\",headRevision:\"h\",changedFiles:[],mapClient:async()=>({freshness:{status:\"unknown\",reason_code:rc}})});let f=0;for(const rc of [\"capability_not_in_active_projection\",\"fact_snapshot_stale\"]){const r=await c(rc);if(r.gate!==\"impact_unknown\"){f++;console.error(rc,JSON.stringify(r))}}process.exit(f?1:0)"'

- [ ] [BEHAVIOR] [L2] 冻结合同测试 6 条全绿（TDD 由红转绿）
  动作: 从仓库根跑冻结合同测试（sprints/** 在根 vitest include 内）
  预期观察: 6 条 test 全 PASS，无 skip
  等待预算: 120s
  留证: vitest 输出末尾 passed 计数
  Test: manual:bash -c 'npx vitest run sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts --no-cache --reporter=basic 2>&1 | tail -20'
