---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传确定性 reason_code + fail-closed 出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 非 fresh 分支拆分为「确定性→透传 reason_code + fail-closed（retryable:false）」与「瞬时→mapper_stale（retryable:true）」两条出口；配套回归测试落 `__tests__/diff-gate.test.js`。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.test.js 含步骤3a 分流回归 describe 块（复现 mapper_stale 空转的 failing 回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('步骤3a')||!c.includes('deny:impact:manifest_unclaimed'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 确定性结论（stale + reason_code=deny:impact:*）透传 reason_code 且 fail-closed
  动作: 用 mock db（返回 active 合同）+ 注入 mapClient 返回 `freshness={status:'stale',reason_code:'deny:impact:manifest_unclaimed'}`，调用 `evaluateDiffGate`
  预期观察: verdict `gate==='impact_unknown'`、`reason_code==='deny:impact:manifest_unclaimed'`（原文透传）、`retryable===false`、`reason!=='mapper_stale'`
  等待预算: 0s（同步纯函数）
  留证: node -e stdout（OK 行）/ 命令 exit code
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import{evaluateDiffGate}from\"./src/impact-contract/diff-gate.js\";const db={query:async()=>({rows:[{id:\"c1\",repo:\"cecelia\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})};const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({manifest_digest:\"1\".repeat(64),projection_digest:\"2\".repeat(64),fact_revisions:{cecelia:\"base\"},freshness:{status:\"stale\",reason_code:\"deny:impact:manifest_unclaimed\"},affected_nodes:[],required_assertions:[]})});if(r.gate===\"impact_unknown\"&&r.reason_code===\"deny:impact:manifest_unclaimed\"&&r.retryable===false&&r.reason!==\"mapper_stale\"){console.log(\"OK\");process.exit(0)}console.error(\"FAIL\",JSON.stringify(r));process.exit(1)"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: unknown 状态携带确定性 reason_code 同样 fail-closed 透传（边界②默认宁停不空转）
  动作: 注入 mapClient 返回 `freshness={status:'unknown',reason_code:'deny:impact:projection_missing'}`，调用 `evaluateDiffGate`
  预期观察: verdict `reason_code==='deny:impact:projection_missing'`、`retryable===false`、`gate==='impact_unknown'`
  等待预算: 0s
  留证: node -e stdout（OK 行）/ exit code
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import{evaluateDiffGate}from\"./src/impact-contract/diff-gate.js\";const db={query:async()=>({rows:[{id:\"c1\",repo:\"cecelia\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})};const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({manifest_digest:\"1\".repeat(64),projection_digest:\"2\".repeat(64),fact_revisions:{cecelia:\"base\"},freshness:{status:\"unknown\",reason_code:\"deny:impact:projection_missing\"},affected_nodes:[],required_assertions:[]})});if(r.gate===\"impact_unknown\"&&r.reason_code===\"deny:impact:projection_missing\"&&r.retryable===false){console.log(\"OK\");process.exit(0)}console.error(\"FAIL\",JSON.stringify(r));process.exit(1)"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: 真正瞬时不新鲜（stale 无 reason_code）保留 mapper_stale + retryable=true（反向保留，语义不回退）
  动作: 注入 mapClient 返回 `freshness={status:'stale'}`（无 reason_code），调用 `evaluateDiffGate`
  预期观察: verdict `reason==='mapper_stale'`、`retryable===true`、`gate==='impact_unknown'`
  等待预算: 0s
  留证: node -e stdout（OK 行）/ exit code
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import{evaluateDiffGate}from\"./src/impact-contract/diff-gate.js\";const db={query:async()=>({rows:[{id:\"c1\",repo:\"cecelia\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})};const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({manifest_digest:\"1\".repeat(64),projection_digest:\"2\".repeat(64),fact_revisions:{cecelia:\"base\"},freshness:{status:\"stale\"},affected_nodes:[],required_assertions:[]})});if(r.gate===\"impact_unknown\"&&r.reason===\"mapper_stale\"&&r.retryable===true){console.log(\"OK\");process.exit(0)}console.error(\"FAIL\",JSON.stringify(r));process.exit(1)"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: reason_code 为纯空白视为瞬时，保留 mapper_stale 重试（边界①：不当确定性结论）
  动作: 注入 mapClient 返回 `freshness={status:'stale',reason_code:'   '}`（纯空白），调用 `evaluateDiffGate`
  预期观察: verdict `reason==='mapper_stale'`、`retryable===true`（空白 trim 后为空，不判确定性）
  等待预算: 0s
  留证: node -e stdout（OK 行）/ exit code
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e "import{evaluateDiffGate}from\"./src/impact-contract/diff-gate.js\";const db={query:async()=>({rows:[{id:\"c1\",repo:\"cecelia\",base_revision:\"base\",contract_body:{affected_capabilities:[],required_assertions:[]}}]})};const r=await evaluateDiffGate({db,taskId:\"t\",repo:\"cecelia\",headRevision:\"head\",mapClient:async()=>({manifest_digest:\"1\".repeat(64),projection_digest:\"2\".repeat(64),fact_revisions:{cecelia:\"base\"},freshness:{status:\"stale\",reason_code:\"   \"},affected_nodes:[],required_assertions:[]})});if(r.gate===\"impact_unknown\"&&r.reason===\"mapper_stale\"&&r.retryable===true){console.log(\"OK\");process.exit(0)}console.error(\"FAIL\",JSON.stringify(r));process.exit(1)"'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed]: diff-gate 全量套件绿——确定性/瞬时双出口均 impact_unknown 不放行，既有 pass/extend/drift/fail-closed 回归不回退
  动作: 子 shell 切进 packages/brain，跑 `diff-gate.test.js` 全量套件（含本轮新增 3a 分流用例 + 既有全部裁决/fail-closed 回归）
  预期观察: 套件全绿（含既有「无 active contract fail-closed」「Mapper 超时 blocked」「revision mismatch」等不回退），进程 exit 0
  等待预算: 120s（vitest 冷启动 + 全套件）
  留证: vitest --reporter=verbose 输出末尾 Tests 行（passed，failed 0）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=verbose'
  期望: exit 0（Tests 全 passed）

<!-- INV 映射（Step 1.3 历史约束三源）：
  - [fail-closed] Diff Impact Gate 任何不可判定情形均 fail-closed → INV-1（B-05 全量套件含既有 fail-closed 回归，且 B-01~B-04 双出口均 impact_unknown 绝不 pass/extend/drift）
  - [租户隔离] 记忆/数据/测试按租户隔离 → N/A：本单为纯函数裁决分流，不触碰租户数据/记忆读写路径
  - 累积 FR: 本 line（journey e6f803f2）暂无已验收 ability 历史，无回退项
-->
