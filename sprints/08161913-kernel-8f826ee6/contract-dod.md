---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + fail-closed 出口（r5）

**范围**: 仅 packages/brain 消费方——diff-gate.js（三分类）、harness-gates.js（gateReceipt 透传）、orchestrator/loop.js（DETERMINISTIC set + failure_class）、orchestrator/derive.js（reason→动作路由）；radius.js / map-client.js 不改。合同冻结测试落 sprints/08161913-kernel-8f826ee6/tests/。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同冻结测试全部落 sprints/08161913-kernel-8f826ee6/tests/（铁律[冻结产物路径]）
  Test: node -e "const fs=require('fs');for(const f of ['diff-gate-reason-classify.test.js','harness-gates-receipt-passthrough.test.js','derive-impact-route.test.js','regression-d1360a48.test.js','fixtures/d1360a48-radius.json']){fs.accessSync('sprints/08161913-kernel-8f826ee6/tests/'+f);}"

- [ ] [ARTIFACT] diff-gate.js 三分类逻辑已实现（含 mapper_contract_invalid fail-closed 出口）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('mapper_contract_invalid')||!c.includes('impact_anchor_missing'))process.exit(1)"

- [ ] [ARTIFACT] 永久回归测试由 Generator 复制到 packages/brain/src/**/__tests__/（brain CI 收割）
  Test: node -e "const {execSync}=require('child_process');const out=execSync('ls packages/brain/src/impact-contract/__tests__/',{encoding:'utf8'});if(!/diff-gate/.test(out))process.exit(1)"

## BEHAVIOR 条目（五行剧本，autonomous / local_api）

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 按 reason_code 三分类（含 (c) fail-closed）
  动作: 真跑 diff-gate 分类合同测试（mock 顶替未改的上游 radius，真跑被改的 diff-gate 分类）
  预期观察: 确定性 reason_code→blocked/retryable:false+detail；真新鲜度→mapper_stale/retryable:true；未知→mapper_contract_invalid/retryable:false
  等待预算: 60s
  留证: /tmp/b01.log 末 20 行（含 "Tests N passed"）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/diff-gate-reason-classify.test.js >/tmp/b01.log 2>&1 && grep -qE "Tests +7 passed" /tmp/b01.log && ! grep -qE "[0-9]+ failed" /tmp/b01.log && echo OK || { tail -20 /tmp/b01.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: harness-gates.beforeEvaluate gateReceipt 透传 reason/retryable/detail
  动作: 真跑 gateReceipt 透传合同测试（beforeEvaluate 经 DI seam 注入 blocked 结果）
  预期观察: receipt.detail.unclaimed_files / receipt.detail.capability_ids 不再 undefined，reason/retryable=false 透传
  等待预算: 60s
  留证: /tmp/b02.log 末 20 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/harness-gates-receipt-passthrough.test.js >/tmp/b02.log 2>&1 && grep -qE "Tests +2 passed" /tmp/b02.log && ! grep -qE "[0-9]+ failed" /tmp/b02.log && echo OK || { tail -20 /tmp/b02.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: derive 按 reason 路由（generator-fix 一次 / 二次 human_review / coverage 直接 human_review）
  动作: 真跑 derive 路由合同测试（derive 纯函数真调，decisionLog 注入确定性 impact 阻断行）
  预期观察: impact_anchor_missing 首次→spawn:generator-fix 带 unclaimed_files；二次→wait:human_review；capability_assertion_coverage_missing→直接 wait:human_review
  等待预算: 60s
  留证: /tmp/b03.log 末 20 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/derive-impact-route.test.js >/tmp/b03.log 2>&1 && grep -qE "Tests +3 passed" /tmp/b03.log && ! grep -qE "[0-9]+ failed" /tmp/b03.log && echo OK || { tail -20 /tmp/b03.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: run d1360a48 真实回归夹具复现（blocked:impact_anchor_missing，非 mapper_stale）
  动作: 用 run d1360a48 录制的真实 radius 输出 + 真实 changed_files（含 DoD.md）喂 diff-gate
  预期观察: gate=blocked、reason=impact_anchor_missing、retryable=false、detail.unclaimed_files=['DoD.md']，reason 绝不为 mapper_stale
  等待预算: 60s
  留证: /tmp/b04.log 末 20 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/regression-d1360a48.test.js >/tmp/b04.log 2>&1 && grep -qE "Tests +1 passed" /tmp/b04.log && ! grep -qE "[0-9]+ failed" /tmp/b04.log && echo OK || { tail -20 /tmp/b04.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: loop.js DETERMINISTIC_IMPACT_ERROR_CODES 补入 5 个确定性 reason（failure_class=impact_contract_invalid 不退避）
  动作: 断言 loop.js 的 DETERMINISTIC_IMPACT_ERROR_CODES 集合含 5 个确定性 reason
  预期观察: impact_anchor_missing / capability_assertion_coverage_missing / capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous 全部在集合内
  等待预算: 10s
  留证: 命令 stdout（OK 或缺失项名）
  Test: manual:bash -c 'cd /workspace && node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/orchestrator/loop.js\",\"utf8\");const i=c.indexOf(\"DETERMINISTIC_IMPACT_ERROR_CODES\");const set=c.slice(i,i+700);for(const r of [\"impact_anchor_missing\",\"capability_assertion_coverage_missing\",\"capability_not_in_active_projection\",\"unsafe_assertion_ref\",\"assertion_identity_ambiguous\"]){if(!set.includes(r)){console.error(\"missing\",r);process.exit(1);}}console.log(\"OK\");"'

- [ ] [BEHAVIOR] [L2] B-06: Final E2E — orchestrator_decision_log 落确定性拦截行（scratch 库，带时间窗）[接缝×2]
  动作: 对 scratch Brain 用真实 append() + 被改 diff-gate 写一条 impact_anchor_missing 前置闸决策行，psql 读回
  预期观察: orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.detail.unclaimed_files 非空
  等待预算: 120s
  留证: psql count 输出（≥1）+ /tmp/harness-unit.log
  Test: manual:bash -c 'cd /workspace && bash sprints/08161913-kernel-8f826ee6/e2e-verify.sh'

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] 未知/新增 reason_code fail-closed retryable:false（禁默认放行/默认可重试）
  动作: 真跑 diff-gate 测试 (c) 未知 reason_code 例
  预期观察: gate=impact_unknown、reason=mapper_contract_invalid、retryable=false
  等待预算: 60s
  留证: /tmp/inv1.log 末 10 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/diff-gate-reason-classify.test.js -t "未知/新增 reason_code" >/tmp/inv1.log 2>&1 && grep -qE "1 passed" /tmp/inv1.log && ! grep -qE "[0-9]+ failed" /tmp/inv1.log && echo OK || { tail -10 /tmp/inv1.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-2 [不动生产方] radius.js baseFreshness 与 map-client.assertMapperContract 语义不变（只改消费方）
  动作: 断言 radius.js 仍产出真新鲜度 reason_code、map-client 仍有 assertMapperContract（未被本单改写）
  预期观察: radius.js 含 fact_snapshot_stale 且 map-client.js 含 assertMapperContract
  等待预算: 10s
  留证: 命令 stdout
  Test: manual:bash -c 'cd /workspace && node -e "const fs=require(\"fs\");const r=fs.readFileSync(\"packages/brain/src/map/radius.js\",\"utf8\");const m=fs.readFileSync(\"packages/brain/src/impact-contract/map-client.js\",\"utf8\");if(!r.includes(\"fact_snapshot_stale\")||!m.includes(\"assertMapperContract\"))process.exit(1);console.log(\"OK\");"'

- INV-3 [不放宽radius] 不放宽 radius 无主文件/断言覆盖规则 → N/A：本单不改 radius.js，radius 判定规则原样保留（由 INV-2 grep 佐证 radius.js 未动语义）。
- INV-4 [不补断言] 不给能力 G1 补断言 → N/A：本单不新增 journey_step_links 断言，capability_assertion_coverage_missing 走 human_review 交人补（另立 Map 覆盖任务）。
- INV-5 [planner分支] Planner 只在服务端签发 PLANNER_BRANCH 作业 → N/A：本单为 proposer/generator 阶段，不涉及 Planner checkout。

## Brain 门禁

- [ ] [BEHAVIOR] [L2] DEVGATE: Brain semver bump 四处同步 + facts-check + version-sync + dod-mapping
  动作: 由 Generator 实现阶段 bump 版本并跑 DevGate 三项
  预期观察: check-version-sync.sh 四处版本一致、facts-check 通过、check-dod-mapping 通过
  等待预算: 120s
  留证: 三命令 stdout
  Test: manual:bash -c 'cd /workspace && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && echo OK'
