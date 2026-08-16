---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并 fail-closed 出口

**范围**: packages/brain diff-gate.js 三分类 + harness-gates.js gateReceipt 透传 detail + loop.js 确定性 impact 出口路由；Brain semver 四处同步 + DevGate 三项。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 消费处按 reason_code 三分类（含 blocked 分支与 mapper_contract_invalid fail-closed）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('mapper_contract_invalid')||!c.includes('blocked'))process.exit(1)"
- [ ] [ARTIFACT] loop.js 导出 routeDeterministicImpact 且 DETERMINISTIC_IMPACT_ERROR_CODES 补齐确定性 reason
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('routeDeterministicImpact')||!c.includes('impact_anchor_missing'))process.exit(1)"
- [ ] [ARTIFACT] 永久回归测试由 Generator 复制到 packages/brain/src/impact-contract/__tests__/ 与 orchestrator/__tests__/（冻结测试留在 sprints/.../tests/）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts'))process.exit(1)"
- [ ] [ARTIFACT] Brain semver 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: bash -c 'V=$(node -e "process.stdout.write(require(\"./packages/brain/package.json\").version)"); tail -1 .brain-versions | grep -qx "$V"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 把 impact_anchor_missing 判为 blocked/retryable:false 且 detail 带 unclaimed_files
  动作: 运行冻结测试，注入 mapper 返回 {freshness:{status:'unknown',reason_code:'impact_anchor_missing'},unclaimed_files:['DoD.md']}，真实跑 evaluateDiffGate
  预期观察: 返回 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']
  等待预算: 0s
  留证: /tmp/b01.log 末尾（vitest passed 行）
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts -t "impact_anchor_missing 分类为 blocked" >/tmp/b01.log 2>&1 || { tail -25 /tmp/b01.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: diff-gate 把 capability_assertion_coverage_missing 判为 blocked/retryable:false 且 detail 带 capability_ids
  动作: 运行冻结测试，注入 mapper 返回 capability_assertion_coverage_missing + affected_nodes=[{capability_id:'G1'}]
  预期观察: 返回 gate='blocked'、reason='capability_assertion_coverage_missing'、retryable=false、detail.capability_ids=['G1']
  等待预算: 0s
  留证: /tmp/b02.log 末尾
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts -t "capability_assertion_coverage_missing 分类为 blocked" >/tmp/b02.log 2>&1 || { tail -25 /tmp/b02.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: diff-gate 对 fact_snapshot_stale 保持 impact_unknown/mapper_stale/retryable:true（回归保护 INV-3）
  动作: 运行冻结测试，注入 mapper 返回 {freshness:{status:'stale',reason_code:'fact_snapshot_stale'}}
  预期观察: 返回 gate='impact_unknown'、reason='mapper_stale'、retryable=true（真新鲜度问题不被误判为 blocked）
  等待预算: 0s
  留证: /tmp/b03.log 末尾
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts -t "fact_snapshot_stale 保持 impact_unknown" >/tmp/b03.log 2>&1 || { tail -25 /tmp/b03.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: diff-gate 对未知 reason_code fail-closed 为 mapper_contract_invalid/retryable:false（INV-1）
  动作: 运行冻结测试，注入 mapper 返回 {freshness:{status:'unknown',reason_code:'brand_new_reason_xyz'}}
  预期观察: 返回 gate='impact_unknown'、reason='mapper_contract_invalid'、retryable=false（不静默放行、不无限重试）
  等待预算: 0s
  留证: /tmp/b04.log 末尾
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts -t "未知 reason_code fail-closed" >/tmp/b04.log 2>&1 || { tail -25 /tmp/b04.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: harness-gates beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail（INV-4）
  动作: 运行冻结测试，注入 diffGate 返回 blocked+detail，pr 为 verified git_candidate，真实跑 beforeEvaluate→gateReceipt
  预期观察: 受理单 reason='impact_anchor_missing'、retryable=false、detail={unclaimed_files:['DoD.md'],capability_ids:[]}、顶层 unclaimed_files=['DoD.md']
  等待预算: 0s
  留证: /tmp/b05.log 末尾
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/harness-gates-receipt.test.ts -t "gateReceipt 含 reason retryable detail" >/tmp/b05.log 2>&1 || { tail -25 /tmp/b05.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-06: loop DETERMINISTIC_IMPACT_ERROR_CODES 补齐 + routeDeterministicImpact 按 reason 路由（generator-fix / human_review）
  动作: 运行冻结测试，import 真实 DETERMINISTIC_IMPACT_ERROR_CODES 与 routeDeterministicImpact 并断言路由
  预期观察: 集合含六确定性 reason；impact_anchor_missing 首次→spawn:generator-fix（detail 带 unclaimed_files），二次→wait:human_review；capability_assertion_coverage_missing→wait:human_review；retryable:true→null
  等待预算: 0s
  留证: /tmp/b06.log 末尾
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/loop-impact-route.test.ts >/tmp/b06.log 2>&1 || { tail -30 /tmp/b06.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-07: run d1360a48 回归夹具（真实 changed_files 含 DoD.md 录制件）新代码判为 blocked/impact_anchor_missing
  动作: 运行回归夹具测试，喂入 fixtures/d1360a48-radius.json 录制的 mapper 响应与 changed_files
  预期观察: 返回 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files 含 'DoD.md'（旧代码返回 mapper_stale，此为回归红→绿）
  等待预算: 0s
  留证: /tmp/b07.log 末尾
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/d1360a48-regression.test.ts >/tmp/b07.log 2>&1 || { tail -25 /tmp/b07.log; exit 1; }'

## Invariant 覆盖映射（铁律三源之一）

- INV-1 [fail-closed]：未知/无法判定 impact 结论 fail-closed，禁静默放行/无限重试 → 覆盖于 B-04
- INV-2 [不放宽规则]：不改 radius 结论，只改消费方分类 → N/A（范围约束，ARTIFACT diff/scope 保证，不改 radius.js/map-client.js）
- INV-3 [回归保护]：fact_snapshot_stale 等五类保持 mapper_stale/retryable:true → 覆盖于 B-03
- INV-4 [可判因]：确定性拒绝透传 reason_code + unclaimed_files/capability_ids 进 orchestrator_decision_log → 覆盖于 B-05（受理单透传）+ E2E（落库出口行）
