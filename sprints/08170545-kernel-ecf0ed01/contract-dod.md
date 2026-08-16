---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js`（reason_code 三分类 + detail 透传）、`packages/brain/src/impact-contract/harness-gates.js`（gateReceipt 透传 reason/retryable/detail）、`packages/brain/src/orchestrator/loop.js` + `derive.js`（DETERMINISTIC_IMPACT_ERROR_CODES 补集 + retryable:false 确定性出口 → generator-fix / human_review）、Brain semver 四处同步。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 含 reason_code 三分类（确定性集合 + 新鲜度集合 + fail-closed 兜底）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('mapper_contract_invalid'))process.exit(1)"

- [ ] [ARTIFACT] harness-gates.js gateReceipt 透传 detail
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/harness-gates.js','utf8');if(!/detail\s*:/.test(c.split('function gateReceipt')[1].slice(0,400)))process.exit(1)"

- [ ] [ARTIFACT] loop.js DETERMINISTIC_IMPACT_ERROR_CODES 补入确定性 reason（含 impact_anchor_missing）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('capability_assertion_coverage_missing'))process.exit(1)"

- [ ] [ARTIFACT] radius.js 未改（结论本身正确，只改消费方）
  Test: node -e "const {execSync}=require('child_process');const d=execSync('git diff --name-only origin/main...HEAD',{encoding:'utf8'});if(d.split('\n').includes('packages/brain/src/map/radius.js'))process.exit(1)"

- [ ] [ARTIFACT] Brain semver 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: manual:bash -c 'bash scripts/check-version-sync.sh 2>&1 | grep -q "All version files in sync"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 按 reason_code 三分类（确定性 blocked/retryable=false/detail + 新鲜度回归 + fail-closed）
  动作: 对真实 evaluateDiffGate 喂入 mapper freshness.status='unknown' 各 reason_code（impact_anchor_missing / capability_assertion_coverage_missing / fact_snapshot_stale / 未知码）与 d1360a48 录制件
  预期观察: 确定性码 → gate=blocked/retryable=false/detail.unclaimed_files 非空；fact_snapshot_stale → impact_unknown/mapper_stale/retryable=true；未知码 → impact_unknown/mapper_contract_invalid/retryable=false
  等待预算: 0s
  留证: vitest 输出末 10 行（含 5 tests passed）
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/impact-contract/__tests__/diff-gate-reason-code.test.js'

- [ ] [BEHAVIOR] [L2] B-02: harness-gates beforeEvaluate 回执透传 reason/retryable/detail
  动作: 对真实 createHarnessImpactGates.beforeEvaluate 注入返回 blocked/impact_anchor_missing/detail 的 diffGate
  预期观察: 返回 receipt.reason='impact_anchor_missing'、receipt.retryable=false、receipt.detail.unclaimed_files=['DoD.md']
  等待预算: 0s
  留证: vitest 输出末 10 行
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/impact-contract/__tests__/harness-gates-receipt.test.js'

- [ ] [BEHAVIOR] [L2] B-03: derive 对 retryable:false impact 结论按 reason 路由确定性出口
  动作: 对真实 derive() 喂入 verdict:attempt_callback（failure_class=impact_contract_invalid，reason 分别为 impact_anchor_missing / capability_assertion_coverage_missing / 已 fix 一次）
  预期观察: impact_anchor_missing→spawn:generator-fix；capability_assertion_coverage_missing→wait:human_review；已 fix 一次→wait:human_review（不再退避重试）
  等待预算: 0s
  留证: vitest 输出末 10 行
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/orchestrator/__tests__/derive-impact-route.test.js'

- [ ] [BEHAVIOR] [L2] [接缝×2] B-04: Final E2E 确定性 verdict 落 orchestrator_decision_log（真 Postgres）
  动作: 空库 bootstrap 后跑 E2E（真 diff-gate 分类 + 真 harness-gates 回执 + 真 appendHop 写入），触发含 Map 无主文件的前置闸
  预期观察: orchestrator_decision_log 5 分钟内新增行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 unclaimed_files 非空
  等待预算: 0s（同步写入后即查）
  留证: e2e-verify.sh 输出末 5 行（含 run_id + ✅ 行）+ psql 查询输出
  Test: manual:bash -c 'bash sprints/08170545-kernel-ecf0ed01/e2e-verify.sh'

- [ ] [BEHAVIOR] INV-1: 真新鲜度问题（fact_snapshot_stale 等）仍 retryable:true（回归保护，禁止误判为确定性）
  动作: 同 B-01 中 fact_snapshot_stale 分支
  预期观察: gate=impact_unknown、reason=mapper_stale、retryable=true 不变
  等待预算: 0s
  留证: B-01 vitest 中该 it 绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/impact-contract/__tests__/diff-gate-reason-code.test.js -t "fact_snapshot_stale"'

- [ ] [BEHAVIOR] INV-2: 未知/新增 reason_code 一律 fail-closed（retryable:false，禁止静默当新鲜度重试）
  动作: 同 B-01 中未知 reason_code 分支
  预期观察: gate=impact_unknown、reason=mapper_contract_invalid、retryable=false
  等待预算: 0s
  留证: B-01 vitest 中该 it 绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/impact-contract/__tests__/diff-gate-reason-code.test.js -t "未知 reason_code"'

- [ ] [BEHAVIOR] INV-3（铁律[重试身份]）: Generator 基础设施失败重试身份不变（既有 derive 回归不回退）
  动作: 跑既有 derive 基础设施重试回归
  预期观察: 首次 generator 重派 generator、generator-fix 重派 generator-fix（callback_infrastructure_blocked）不变
  等待预算: 0s
  留证: vitest 输出
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/orchestrator/__tests__/derive-generator-infrastructure-retry.test.js'

> 铁律 [planner分支] / [BrainURL权威] / [评估时钟]：N/A —— 本 sprint 只改 impact 闸消费方（diff-gate/harness-gates/loop/derive），不触及 planner workspace、HARNESS_BRAIN_URL 注入、existing-PR evaluator 时钟。
