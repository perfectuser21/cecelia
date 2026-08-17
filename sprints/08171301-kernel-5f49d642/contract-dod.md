---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并 fail-closed 出口

**范围**: packages/brain/src/impact-contract/diff-gate.js（三分类+reason_code+detail 透传）、harness-gates.js（gateReceipt 透传 detail）、orchestrator/loop.js（retryable:false 不退避）、orchestrator/derive.js（DETERMINISTIC_IMPACT_ERROR_CODES + reason→出口路由）、Brain semver 四处同步 + DevGate 三项。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 消费 mapper 结论时按 reason_code 分类（引用确定性 reason_code 集合）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('capability_assertion_coverage_missing'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] derive.js 补齐 DETERMINISTIC_IMPACT_ERROR_CODES / impact_contract_invalid 路由（loop.js 亦引用）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('impact_contract_invalid'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] Final E2E 驱动脚本存在且引用真 appendHop 写决策日志
  Test: node -e "const c=require('fs').readFileSync('sprints/08171301-kernel-5f49d642/e2e/impact-gate-decision-log-e2e.mjs','utf8');if(!c.includes('appendHop')||!c.includes('orchestrator_decision_log'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 确定性 impact_anchor_missing → blocked/retryable=false/detail.unclaimed_files
  动作: 以 mapper 返回 `{freshness:{status:'unknown',reason_code:'impact_anchor_missing'},unclaimed_files:['DoD.md']}` 真调 evaluateDiffGate（不传 db，走 3a 分类）
  预期观察: 返回 `{gate:'blocked',reason:'impact_anchor_missing',retryable:false,detail:{unclaimed_files:['DoD.md']}}`
  等待预算: 0s
  留证: ${SPRINT_DIR}/tests 下 vitest 输出末尾 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/diff-gate-impact-reason-code.test.ts -t "impact_anchor_missing → blocked" --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: diff-gate 确定性 capability_assertion_coverage_missing → blocked/retryable=false/detail.capability_ids 非空
  动作: 以 mapper 返回 `reason_code:'capability_assertion_coverage_missing'` + affected_nodes=[{capability_id:'G1'}] 真调 evaluateDiffGate
  预期观察: 返回 gate='blocked'、reason 同名、retryable=false、detail.capability_ids 含 'G1'
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/diff-gate-impact-reason-code.test.ts -t "capability_assertion_coverage_missing → blocked" --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 回归保护 — 真新鲜度 fact_snapshot_stale 仍 impact_unknown/mapper_stale/retryable=true
  动作: 以 mapper 返回 `{freshness:{status:'stale',reason_code:'fact_snapshot_stale'}}` 真调 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown'、reason='mapper_stale'、retryable=true（可重试不误伤）
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/diff-gate-impact-reason-code.test.ts -t "fact_snapshot_stale" --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: fail-closed — 未知 reason_code → impact_unknown/mapper_contract_invalid/retryable=false
  动作: 以 mapper 返回 `{freshness:{status:'unknown',reason_code:'totally_new_reason_code_from_future'}}` 真调 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown'、reason='mapper_contract_invalid'、retryable=false（不放行不重试）
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/diff-gate-impact-reason-code.test.ts -t "mapper_contract_invalid" --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: harness-gates beforeEvaluate gateReceipt 透传 reason/retryable/detail
  动作: 确定性 blocked 候选经真 beforeEvaluate（真 diff-gate + 注入 mapper）产出 gateReceipt
  预期观察: gateReceipt.reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/harness-gates-before-evaluate-passthrough.test.ts -t "gateReceipt.reason=impact_anchor_missing" --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-06: derive 按 reason 路由 — impact_anchor_missing→generator-fix，coverage_missing→human_review
  动作: 构造 decisionLog 含 `deny:impact:<reason>` + detail.impact_gate.retryable=false 的 observed，真调纯函数 derive
  预期观察: impact_anchor_missing 首次→action='spawn:generator-fix'（detail 带 unclaimed_files）；已 fix 过→'wait:human_review'；capability_assertion_coverage_missing→'wait:human_review'
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/derive-impact-deterministic-routing.test.ts --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-07: 录制件回归 — run d1360a48 真实 changed_files 复现旧 mapper_stale→新 blocked
  动作: 用 run d1360a48 录制 radius 响应（含 DoD.md unclaimed）真调 evaluateDiffGate
  预期观察: 返回 blocked/impact_anchor_missing/retryable=false/detail.unclaimed_files=['DoD.md']
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/diff-gate-recorded-fixture.test.ts --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

- [ ] [BEHAVIOR] [L2] [接缝×2] B-08: Final E2E — 确定性 impact 结论落 orchestrator_decision_log（真 scratch 库）
  动作: 对 scratch 库跑真 migration bootstrap + 真 beforeEvaluate + 真 appendHop 驱动（node e2e 脚本）
  预期观察: orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.detail.unclaimed_files 非空
  等待预算: 30s
  留证: 驱动 stdout(含 RUN_ID) + psql count 输出
  Test: manual:bash -c 'set -e; : "${DB_URL:?}"; OUT=$(node sprints/08171301-kernel-5f49d642/e2e/impact-gate-decision-log-e2e.mjs); RID=$(printf "%s\n" "$OUT" | sed -n "s/^RUN_ID=//p"); [ -n "$RID" ] || { echo FAIL; exit 1; }; C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='"'"'$RID'"'"' AND gate_verdict='"'"'deny:impact:impact_anchor_missing'"'"' AND (detail->'"'"'impact_gate'"'"'->>'"'"'retryable'"'"')='"'"'false'"'"' AND created_at > NOW() - INTERVAL '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" -ge 1 ] || { echo FAIL; exit 1; }; echo OK'

## Invariant 铁律映射（历史约束三源 — controller 注入铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [重试身份] generator-fix 只重派 generator-fix（本单 derive 路由 impact_anchor_missing→generator-fix 一次，不改重试身份语义；B-06 覆盖首次 generator-fix、重复转 human_review）
  动作: 真调纯函数 derive，断言首次 impact_anchor_missing 的路由动作
  预期观察: action='spawn:generator-fix'（重试身份未被本单破坏）
  等待预算: 0s
  留证: vitest 输出 pass 行
  Test: manual:bash -c 'npx vitest run sprints/08171301-kernel-5f49d642/tests/derive-impact-deterministic-routing.test.ts -t "spawn:generator-fix" --reporter=basic >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }'

INV-2 [已有PR时钟] validation_clock_required 默认 fail-closed — N/A：本单不触碰 validation clock / PR 时钟逻辑（仅改 impact 闸消费侧）
INV-3 [Fleet Brain URL] HARNESS_BRAIN_URL 预检 fail-closed — N/A：本单不触碰 Dispatcher/Worker URL 注入
INV-4 [Planner分支] Planner 停在服务端 planner_branch — N/A：本单为 kernel 调度逻辑，不触碰 planner workspace
