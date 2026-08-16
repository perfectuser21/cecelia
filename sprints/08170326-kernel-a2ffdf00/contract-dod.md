---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口

**范围**: packages/brain/src/impact-contract/diff-gate.js（三类裁决 + reason_code 透传 + detail）、harness-gates.js（beforeEvaluate gateReceipt 透传 detail）、orchestrator/constants.js（DETERMINISTIC_IMPACT_ERROR_CODES 导出 + 补齐）、orchestrator/loop.js（import 常量 + retryable:false 走确定性出口）、orchestrator/derive.js（按 reason 路由 generator-fix/human_review）；Brain semver 四处同步。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate 三类裁决冻结测试存在且断言 blocked/reason_code/retryable
  Test: node -e "const c=require('fs').readFileSync('sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts','utf8');if(!c.includes('mapper_contract_invalid')||!c.includes('impact_anchor_missing'))process.exit(1)"

- [ ] [ARTIFACT] DETERMINISTIC_IMPACT_ERROR_CODES 由 constants.js 导出（loop.js 不再局部定义）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/constants.js','utf8');if(!/export const DETERMINISTIC_IMPACT_ERROR_CODES/.test(c))process.exit(1)"

- [ ] [ARTIFACT] INV [枚举全仓grep] loop.js 从 constants.js 导入确定性码集合，不重复局部定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(/const DETERMINISTIC_IMPACT_ERROR_CODES\s*=\s*new Set/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Brain semver 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目（五行剧本，evaluator 从 /workspace 根用 root vitest.config.js 实跑；INV [合同实跑]：sprints/** 在 root include 内，非 packages/brain 局部 config）

- [ ] [BEHAVIOR] [L2] B-01: 候选含无主文件 → diff-gate 确定性 blocked（impact_anchor_missing）
  动作: 从 /workspace 跑冻结测试 diff-gate-reason-code.test.ts（注入 mapClient 返回 status:unknown/reason_code:impact_anchor_missing/unclaimed_files:['DoD.md']）
  预期观察: 结果 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']；空 unclaimed_files 边界仍 blocked 不降级
  等待预算: 0s
  留证: vitest 输出末 5 行（Test Files 1 passed）
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-02: 受影响能力零断言 → 确定性 blocked（capability_assertion_coverage_missing）
  动作: 从 /workspace 跑该测试 capability_assertion_coverage_missing + 其余确定性码用例
  预期观察: reason='capability_assertion_coverage_missing'、retryable=false、detail.capability_ids 含受影响能力；capability_not_in_active_projection/unsafe_assertion_ref/assertion_identity_ambiguous 同落 blocked/retryable=false
  等待预算: 0s
  留证: vitest 输出（含 detail.capability_ids 断言用例名）
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts -t "capability" --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-03: 真新鲜度回归保护 + 未知码 fail-closed
  动作: 从 /workspace 跑该测试「回归保护」+「fail-closed」用例
  预期观察: 5 个真新鲜度码仍 impact_unknown/mapper_stale/retryable=true（语义不回退）；未知 reason_code → impact_unknown/mapper_contract_invalid/retryable=false
  等待预算: 0s
  留证: vitest 输出（回归保护 5 passed + fail-closed 1 passed）
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-04: harness-gates beforeEvaluate gateReceipt 透传 reason/retryable/detail
  动作: 从 /workspace 跑冻结测试 harness-gates-receipt-detail.test.ts（注入 diffGate 返回 blocked+detail）
  预期观察: gateReceipt.reason/retryable 透传，且新增 detail.unclaimed_files/capability_ids 非空透传；mapper_stale 回归用例 retryable=true
  等待预算: 0s
  留证: vitest 输出（Test Files 1 passed）
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08170326-kernel-a2ffdf00/tests/harness-gates-receipt-detail.test.ts --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-05: INV [同语义同策略] DETERMINISTIC_IMPACT_ERROR_CODES 判变端/消费端共用同一集合
  动作: 从 /workspace 跑冻结测试 deterministic-impact-codes.test.ts（真读 constants.js 导出）
  预期观察: 集合由 constants.js 导出且为 Set，含 6 个确定性 reason（含新增 mapper_contract_invalid），不含 mapper_stale/fact_snapshot_stale 等可重试码
  等待预算: 0s
  留证: vitest 输出（Test Files 1 passed）
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08170326-kernel-a2ffdf00/tests/deterministic-impact-codes.test.ts --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-06: run d1360a48 真实 changed_files 回归夹具（不依赖实时 Map）
  动作: 从 /workspace 跑冻结测试 diff-gate-d1360a48-regression.test.ts（录制 radius 响应，含仓库根 DoD.md）
  预期观察: 旧代码返 mapper_stale/retryable:true 的输入，新代码返 blocked/impact_anchor_missing/retryable=false/detail.unclaimed_files 含 DoD.md
  等待预算: 0s
  留证: vitest 输出（Test Files 1 passed）
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-d1360a48-regression.test.ts --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] [接缝×2] B-07: Final E2E — 确定性 blocked 真落 orchestrator_decision_log（数据写入类）
  动作: 对 scratch Brain（Fleet 注入空库 DB_URL）跑仓库真实 migration，真跑 diff-gate+harness-gates 产确定性 blocked receipt，经真实 appendHop 写决策日志，psql 读回
  预期观察: orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.detail.unclaimed_files 非空（5 分钟时间窗内）
  等待预算: 120s（migration + 写入 + 读回）
  留证: psql 查询输出 "OK E2E: deny:impact:impact_anchor_missing"（进 behavior_tests.evidence）
  Test: manual:bash -c 'cd /workspace && bash sprints/08170326-kernel-a2ffdf00/e2e-verify.sh'
