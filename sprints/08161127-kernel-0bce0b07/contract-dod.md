---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口

**范围**: packages/brain/src/impact-contract/diff-gate.js（三分类）、harness-gates.js（gateReceipt 透传 detail）、packages/brain/src/orchestrator/loop.js（DETERMINISTIC_IMPACT_ERROR_CODES + derive 路由）；Brain semver 四处同步 + DevGate 三项。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 含三分类：确定性 reason_code → blocked/retryable:false，真新鲜度码 → mapper_stale/retryable:true，未知 → mapper_contract_invalid/retryable:false
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('mapper_contract_invalid'))process.exit(1)"

- [ ] [ARTIFACT] harness-gates.js gateReceipt 透传 detail 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/harness-gates.js','utf8');if(!c.includes('detail'))process.exit(1)"

- [ ] [ARTIFACT] loop.js DETERMINISTIC_IMPACT_ERROR_CODES 补入 impact_anchor_missing 与 capability_assertion_coverage_missing
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('capability_assertion_coverage_missing'))process.exit(1)"

- [ ] [ARTIFACT] 永久回归 PG 集成测试存在（Generator 从冻结合同复制并驱动真实 hop）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/impact-gate-deterministic-route.pg.integration.test.js')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: diff-gate 三分类（确定性 blocked / 真新鲜度可重试 / fail-closed）
  动作: 运行冻结测试 diff-gate-classification.test.ts（注入 mapper 各类 freshness.reason_code，真跑 evaluateDiffGate 分类分支）
  预期观察: 确定性码返回 blocked/retryable:false+detail；真新鲜度码仍 impact_unknown/mapper_stale/retryable:true；未知/畸形归 mapper_contract_invalid/retryable:false —— 全 7 用例通过 exit 0
  等待预算: 0s
  留证: vitest 输出末行 + exit code
  Test: manual:bash -c 'npx vitest run sprints/08161127-kernel-0bce0b07/tests/diff-gate-classification.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L1] B-02: 回归夹具 run d1360a48 真实录制件 → blocked:impact_anchor_missing
  动作: 运行冻结测试 diff-gate-regression-fixture.test.ts（喂 fixtures/radius-d1360a48-doc-md.json 真实 radius 录制件）
  预期观察: 结果 gate=blocked、reason=impact_anchor_missing、retryable=false、detail.unclaimed_files=["DoD.md"] —— exit 0
  等待预算: 0s
  留证: vitest 输出末行 + exit code
  Test: manual:bash -c 'npx vitest run sprints/08161127-kernel-0bce0b07/tests/diff-gate-regression-fixture.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L1] B-03: harness-gates.beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail
  动作: 运行冻结测试 harness-gates-receipt.test.ts（注入 diff-gate blocked 结果，真跑 beforeEvaluate + gateReceipt 组装）
  预期观察: 回执含 reason=impact_anchor_missing、retryable=false、detail.unclaimed_files=["DoD.md"]；pass 回执 retryable 默认 false —— exit 0
  等待预算: 0s
  留证: vitest 输出末行 + exit code
  Test: manual:bash -c 'npx vitest run sprints/08161127-kernel-0bce0b07/tests/harness-gates-receipt.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L1] B-04: derive 按 reason 路由（generator-fix / human_review 二选一）
  动作: 运行冻结测试 derive-impact-route.test.ts（构造 loop.js 真实落库形态的 impact deny 行喂真 derive 纯函数）
  预期观察: impact_anchor_missing(retryable=false) → 下一动作 spawn:generator-fix；capability_assertion_coverage_missing(retryable=false) → 下一动作 wait:human_review —— exit 0
  等待预算: 0s
  留证: vitest 输出末行 + exit code
  Test: manual:bash -c 'npx vitest run sprints/08161127-kernel-0bce0b07/tests/derive-impact-route.test.ts --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: 确定性 blocked 结论真实落 orchestrator_decision_log（scratch 库，接缝真验）[接缝×2]
  动作: 对 scratch 库跑真实 migration 后，驱动一次真实 orchestrator hop（注入 mapper 返回 impact_anchor_missing），真 append 落 orchestrator_decision_log，再 psql 独立复核
  预期观察: within 120s orchestrator_decision_log 出现一行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.detail.unclaimed_files 非空（5min 时间窗）；确定性结论未被误标 retryable=true
  等待预算: 120s
  留证: psql count 输出（确定性行数 ≥1 且误标行数 =0）；见 contract-draft.md ## E2E 验收 脚本
  Test: manual:bash -c 'DEADLINE=$((SECONDS+120)); export NODE_ENV=test; until ROW=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE gate_verdict='"'"'deny:impact:impact_anchor_missing'"'"' AND (detail->'"'"'impact_gate'"'"'->>'"'"'retryable'"'"')='"'"'false'"'"' AND jsonb_array_length(COALESCE(detail->'"'"'impact_gate'"'"'->'"'"'detail'"'"'->'"'"'unclaimed_files'"'"','"'"'[]'"'"'::jsonb))>=1 AND created_at > NOW()-INTERVAL '"'"'5 minutes'"'"'" 2>/dev/null | tr -d " ") && [ "${ROW:-0}" -ge 1 ]; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 120s 未见确定性 deny 行"; exit 1; }; sleep 3; done; echo "OK: 确定性 deny 行已落库"'

- [ ] [BEHAVIOR] [L2] B-06: Brain semver 四处同步 + DevGate 版本闸通过
  动作: 运行 check-version-sync.sh 校验版本四处一致
  预期观察: 版本四处一致，脚本 exit 0
  等待预算: 0s
  留证: 脚本 stdout + exit code
  Test: manual:bash -c 'bash scripts/check-version-sync.sh'

## Invariant 覆盖（历史约束三源 — 铁律逐条映射）

- [ ] [BEHAVIOR] [L1] INV-1: fail-closed 铁律 —— 未知/不可判定 mapper 结论必须 retryable:false，不得标可重试
  动作: 运行 diff-gate-classification.test.ts 中未知 reason_code 与 freshness 缺失两条 fail-closed 用例
  预期观察: 两用例均 retryable=false（不会折叠成 mapper_stale/retryable:true）
  等待预算: 0s
  留证: vitest 输出（fail-closed 两用例绿）
  Test: manual:bash -c 'npx vitest run sprints/08161127-kernel-0bce0b07/tests/diff-gate-classification.test.ts -t "fail-closed" --reporter=basic'

- INV-2: radius.js / map-client.js assertMapperContract 产方不动 —— N/A 由 [ARTIFACT] 反向守护：本单不改 radius.js。Test: node -e "const {execSync}=require('child_process');const d=execSync('git diff --name-only HEAD',{encoding:'utf8'});if(d.includes('packages/brain/src/map/radius.js')||d.includes('packages/brain/src/impact-contract/map-client.js'))process.exit(1)"
- INV-3: nightly-red 原始日志铁律 —— N/A：本 sprint 不触及 nightly job 日志模块（PRD 明示本 sprint 不直接相关，铁律留痕）。
