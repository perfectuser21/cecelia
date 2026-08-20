---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 确定性结论 fail-closed 有界出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 的 `evaluateDiffGate` step 3a（freshness 非 fresh 折叠分支）——区分确定性 vs 瞬态，确定性透传 reason_code + retryable:false；瞬态保留 mapper_stale + retryable:true。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js step 3a 含瞬态白名单常量 + 确定性透传/fail-closed 分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/fact_snapshot_stale/.test(c)||!/retryable:\s*false/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 永久回归测试文件存在且覆盖确定性透传
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('revision_mismatch'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 确定性 reason_code 透传 + fail-closed 有界出口
  动作: 调 evaluateDiffGate，注入 mapClient 返回 freshness={status:'stale',reason_code:'revision_mismatch'}（无 db）
  预期观察: 返回 reason='revision_mismatch'（非 mapper_stale）、reason_code='revision_mismatch'、retryable=false
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r=await evaluateDiffGate({taskId:"t",repo:"cecelia",headRevision:"h",mapClient:async()=>({freshness:{status:"stale",reason_code:"revision_mismatch"}})}); if(r.reason!=="revision_mismatch"||r.reason_code!=="revision_mismatch"||r.retryable!==false){console.error("FAIL",JSON.stringify(r));process.exit(1)} console.log("OK",JSON.stringify(r));'"'"''

- [ ] [BEHAVIOR] [L2] B-02: 真·瞬态过期不被误伤，保留 mapper_stale + retryable=true
  动作: 调 evaluateDiffGate，注入 mapClient 返回 freshness={status:'stale',reason_code:'fact_snapshot_stale'}
  预期观察: 返回 reason='mapper_stale'、retryable=true（原瞬态重试语义保留）
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r=await evaluateDiffGate({taskId:"t",repo:"cecelia",headRevision:"h",mapClient:async()=>({freshness:{status:"stale",reason_code:"fact_snapshot_stale"}})}); if(r.reason!=="mapper_stale"||r.retryable!==true){console.error("FAIL",JSON.stringify(r));process.exit(1)} console.log("OK",JSON.stringify(r));'"'"''

- [ ] [BEHAVIOR] [L2] B-03: reason_code 缺失/为空 → fail-closed retryable=false（不吞成 unknown/不无限重试）
  动作: 调 evaluateDiffGate，注入 mapClient 返回 freshness={status:'stale',reason_code:null}
  预期观察: 返回 retryable=false，reason 非 'mapper_stale' 且非 'unknown'（具体 fail-closed 码，可归因）
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r=await evaluateDiffGate({taskId:"t",repo:"cecelia",headRevision:"h",mapClient:async()=>({freshness:{status:"stale",reason_code:null}})}); if(r.retryable!==false||r.reason==="mapper_stale"||r.reason==="unknown"){console.error("FAIL",JSON.stringify(r));process.exit(1)} console.log("OK",JSON.stringify(r));'"'"''

- [ ] [BEHAVIOR] [L2] B-04: Mapper 抛异常回归不破，保持 mapper_unavailable + retryable=true
  动作: 调 evaluateDiffGate，注入 mapClient 抛异常
  预期观察: 返回 reason='mapper_unavailable'、retryable=true（fail-closed，本 sprint 不改此路径）
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r=await evaluateDiffGate({taskId:"t",repo:"cecelia",headRevision:"h",mapClient:async()=>{throw new Error("timeout")}}); if(r.reason!=="mapper_unavailable"||r.retryable!==true){console.error("FAIL",JSON.stringify(r));process.exit(1)} console.log("OK",JSON.stringify(r));'"'"''

- [ ] [BEHAVIOR] [L2] B-05: 永久回归套件全绿（真实 evaluateDiffGate，子 shell 切包根）
  动作: 从 packages/brain 包根跑 diff-gate.test.js（含新增确定性/瞬态回归用例）
  预期观察: vitest 全绿，deny:impact:mapper_stale 空转回归用例证明不再复现
  等待预算: 0s
  留证: vitest --reporter=basic stdout 末尾（passed 计数，无 failed）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] INV-1 [不空转铁律]: 确定性结论不被折叠成 retryable 的 mapper_stale
  动作: 对确定性 reason_code（fail_current_revision）断言 retryable=false 且 reason 非 mapper_stale
  预期观察: retryable=false，reason=fail_current_revision（确定即有界终止）
  等待预算: 0s
  留证: node 断言 stdout（OK + 返回 JSON）
  Test: manual:bash -c 'cd packages/brain && node --input-type=module -e '"'"'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r=await evaluateDiffGate({taskId:"t",repo:"cecelia",headRevision:"h",mapClient:async()=>({freshness:{status:"unknown",reason_code:"fail_current_revision"}})}); if(r.retryable!==false||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)} console.log("OK",JSON.stringify(r));'"'"''

## Invariant 覆盖（历史铁律映射）

- INV-1 [不空转] → 见 B-06（上方 [BEHAVIOR] INV-1）：确定性 Map 结论 retryable=false，不折叠 mapper_stale。
- [fail-closed] → 见 B-03/B-04：不可判定/缺失/不可达情形均 impact_unknown，绝不假绿。

## notes

- judgment-pending-user: ⚠️「确定性 vs 真·瞬态」瞬态白名单取值（fact_snapshot_stale/fact_stale/projection_revision_missing）——采用瞬态白名单+fail-closed 默认模型解析 PRD 第 26/28 行张力，方向 fail-closed 安全，建议对齐会复核白名单是否遗漏可自愈码。
- 范围外：step 3b（fresh 分支的 revision_mismatch/digest_mismatch，diff-gate.js 第 210-234 行）现状 retryable=true 不在本 sprint 范围（PRD 第 39/41 行范围限定，只改 step 3a freshness 折叠）。
- contract-gate: skipped (file not found, third-party repo)
- context-manifest: unavailable (postgres=false)
