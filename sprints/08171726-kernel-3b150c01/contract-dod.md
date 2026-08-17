---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

**范围**: packages/brain 内 `diff-gate.js`（三类分流 + reason_code/detail 透传）、`harness-gates.js`（gateReceipt 透传 detail/unclaimed_files）、`loop.js`+`derive.js`（retryable:false 确定性出口 + 按 reason 路由 generator-fix / human_review）。Brain semver 四处同步 + DevGate 三项。
**大小**: M
**target_environment**: local_api ｜ **journey_type**: autonomous

> 命令约定：DoD 命令从 `${WORKSPACE_PATH:-/workspace}` 根目录执行；DB 由 Fleet 注入 `$DB_URL`（Final E2E 段）。
> 冻结测试位置：合同冻结测试在 `sprints/08171726-kernel-3b150c01/tests/`（Proposer 落此，kernel 采集），从仓库根跑（根 vitest.config.js include 覆盖 sprints/**，已实测可跑）；Generator 复制永久回归到 `packages/brain/src/**/__tests__/`（ARTIFACT 核对）。
> [L1]=注入替身 mapper/deps 验被测逻辑本体（无真 DB）；[L2]=真 Postgres 落行真验。本 sprint 纯后端调度逻辑，无 L3 真机层。

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结测试：diff-gate 三类分流测试在 sprints/<sprint_dir>/tests/
  Test: node -e "require('fs').accessSync('sprints/08171726-kernel-3b150c01/tests/diff-gate-reason-code.test.js')"

- [ ] [ARTIFACT] 冻结测试：harness-gates gateReceipt 透传测试在 sprints/<sprint_dir>/tests/
  Test: node -e "require('fs').accessSync('sprints/08171726-kernel-3b150c01/tests/harness-gates-reason-code.test.js')"

- [ ] [ARTIFACT] 冻结测试：loop/derive 确定性出口路由测试在 sprints/<sprint_dir>/tests/
  Test: node -e "require('fs').accessSync('sprints/08171726-kernel-3b150c01/tests/loop-impact-deterministic-route.test.js')"

- [ ] [ARTIFACT] 冻结测试 + 夹具：回归夹具（run d1360a48 录制件）+ 夹具测试在 sprints/<sprint_dir>/
  Test: node -e "require('fs').accessSync('sprints/08171726-kernel-3b150c01/fixtures/radius-d1360a48-impact-anchor.json');require('fs').accessSync('sprints/08171726-kernel-3b150c01/tests/diff-gate-regression-d1360a48.test.js')"

- [ ] [ARTIFACT] 永久回归：Generator 复制四份冻结测试到 packages/brain/src/**/__tests__/
  Test: node -e "['packages/brain/src/impact-contract/__tests__/diff-gate-reason-code.test.js','packages/brain/src/impact-contract/__tests__/harness-gates-reason-code.test.js','packages/brain/src/impact-contract/__tests__/diff-gate-regression-d1360a48.test.js','packages/brain/src/orchestrator/__tests__/loop-impact-deterministic-route.test.js'].forEach(p=>require('fs').accessSync(p))"

- [ ] [ARTIFACT] Final E2E harness 存在（真 impactGate 链 + 真 appendHop 落 orchestrator_decision_log）
  Test: node -e "require('fs').accessSync('sprints/08171726-kernel-3b150c01/e2e/impact-gate-e2e.mjs')"

- [ ] [ARTIFACT] loop.js DETERMINISTIC_IMPACT_ERROR_CODES 补入确定性 reason（impact_anchor_missing / capability_assertion_coverage_missing）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!/impact_anchor_missing/.test(c)||!/capability_assertion_coverage_missing/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Brain 版本四处同步 = 1.273.72（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: node -e "const v=require('./packages/brain/package.json').version;const l=require('./packages/brain/package-lock.json').version;const fs=require('fs');const bv=fs.readFileSync('.brain-versions','utf8').trim().split('\n').pop().trim();const def=/\*\*Brain 版本\*\*:\s*([0-9.]+)/.exec(fs.readFileSync('DEFINITION.md','utf8'))[1];if(!(v===l&&v===bv&&v===def&&v==='1.273.72'))process.exit(1)"

## BEHAVIOR 条目（五行剧本，内嵌 manual: 命令）

- [ ] [BEHAVIOR] [L1] B-01: diff-gate 确定性结论 impact_anchor_missing → blocked/retryable=false/detail.unclaimed_files
  动作: 调 evaluateDiffGate，注入 mapper 返回 {freshness:{status:'unknown',reason_code:'impact_anchor_missing'},unclaimed_files:['DoD.md']}
  预期观察: 返回 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']（不再是 mapper_stale/retryable:true）
  等待预算: 0s
  留证: node -e 命令 stdout（OK 行 + exit_code）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/impact-contract/diff-gate.js\").then(async m=>{const r=await m.evaluateDiffGate({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},unclaimed_files:[\"DoD.md\"],affected_nodes:[],required_assertions:[]}),changedFiles:[\"DoD.md\"]});if(r.gate!==\"blocked\"||r.reason!==\"impact_anchor_missing\"||r.retryable!==false||!(r.detail&&r.detail.unclaimed_files&&r.detail.unclaimed_files.includes(\"DoD.md\")))process.exit(1);console.log(\"OK\")}).catch(e=>{console.error(String(e));process.exit(1)})"'

- [ ] [BEHAVIOR] [L1] B-02: diff-gate 确定性结论 capability_assertion_coverage_missing → blocked/retryable=false/detail.capability_ids
  动作: 调 evaluateDiffGate，注入 mapper 返回 {freshness:{status:'unknown',reason_code:'capability_assertion_coverage_missing'},affected_nodes:[{capability_id:'G1'}]}
  预期观察: 返回 gate='blocked'、reason='capability_assertion_coverage_missing'、retryable=false、detail.capability_ids 含 'G1'
  等待预算: 0s
  留证: node -e 命令 stdout（OK 行 + exit_code）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/impact-contract/diff-gate.js\").then(async m=>{const r=await m.evaluateDiffGate({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"capability_assertion_coverage_missing\"},unclaimed_files:[],affected_nodes:[{capability_id:\"G1\",owner:\"G1\"}],required_assertions:[]}),changedFiles:[\"apps/dashboard/x.tsx\"]});if(r.gate!==\"blocked\"||r.reason!==\"capability_assertion_coverage_missing\"||r.retryable!==false||!(r.detail&&Array.isArray(r.detail.capability_ids)&&r.detail.capability_ids.includes(\"G1\")))process.exit(1);console.log(\"OK\")}).catch(e=>{console.error(String(e));process.exit(1)})"'

- [ ] [BEHAVIOR] [L1] B-03: diff-gate 真新鲜度 fact_snapshot_stale → impact_unknown/mapper_stale/retryable=true（回归保护，INV-1）
  动作: 调 evaluateDiffGate，注入 mapper 返回 {freshness:{status:'stale',reason_code:'fact_snapshot_stale'}}
  预期观察: 返回 gate='impact_unknown'、reason='mapper_stale'、retryable=true（真 stale 不被误判 blocked，行为不变）
  等待预算: 0s
  留证: node -e 命令 stdout（OK 行 + exit_code）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/impact-contract/diff-gate.js\").then(async m=>{const r=await m.evaluateDiffGate({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"},unclaimed_files:[],affected_nodes:[],required_assertions:[]}),changedFiles:[\"packages/brain/src/x.js\"]});if(r.gate!==\"impact_unknown\"||r.reason!==\"mapper_stale\"||r.retryable!==true)process.exit(1);console.log(\"OK\")}).catch(e=>{console.error(String(e));process.exit(1)})"'

- [ ] [BEHAVIOR] [L1] B-04: diff-gate 未知 reason_code → impact_unknown/mapper_contract_invalid/retryable=false（fail-closed，INV-2）
  动作: 调 evaluateDiffGate，注入 mapper 返回 {freshness:{status:'unknown',reason_code:'brand_new_future_code'}}
  预期观察: 返回 gate='impact_unknown'、reason='mapper_contract_invalid'、retryable=false（不 blocked、不放行、不可重试）
  等待预算: 0s
  留证: node -e 命令 stdout（OK 行 + exit_code）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/impact-contract/diff-gate.js\").then(async m=>{const r=await m.evaluateDiffGate({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"brand_new_future_code\"},unclaimed_files:[],affected_nodes:[],required_assertions:[]}),changedFiles:[\"packages/brain/src/x.js\"]});if(r.gate!==\"impact_unknown\"||r.reason!==\"mapper_contract_invalid\"||r.retryable!==false)process.exit(1);console.log(\"OK\")}).catch(e=>{console.error(String(e));process.exit(1)})"'

- [ ] [BEHAVIOR] [L1] B-05: harness-gates beforeEvaluate gateReceipt 透传 reason/retryable/detail/unclaimed_files（INV-3）
  动作: 从仓库根跑冻结测试 harness-gates-reason-code（真 createHarnessImpactGates.beforeEvaluate + 注入 diffGate 确定性 blocked 结果）
  预期观察: receipt.stage='diff'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']、顶层 unclaimed_files=['DoD.md']（用例 PASS）
  等待预算: 60s
  留证: vitest 用例输出末 5 行（含 passed）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08171726-kernel-3b150c01/tests/harness-gates-reason-code.test.js'

- [ ] [BEHAVIOR] [L1] B-06: loop/derive impact_anchor_missing（retryable:false）→ intent 透传 + 路由 spawn:generator-fix（INV-1/INV-3）
  动作: 从仓库根跑冻结测试 loop-impact-deterministic-route 的 impact_anchor_missing 用例（真 runLoop + 真 derive，注入 beforeEvaluate 确定性 blocked receipt）
  预期观察: intent 行 gate_verdict='deny:impact:impact_anchor_missing'、detail.impact_gate.retryable=false、unclaimed_files=['DoD.md']；下一动作 dispatch 含 'spawn:generator-fix'（不再 blanket failRun/无限重试）（用例 PASS）
  等待预算: 60s
  留证: vitest 用例输出末 5 行（含 passed）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08171726-kernel-3b150c01/tests/loop-impact-deterministic-route.test.js -t "impact_anchor_missing"'

- [ ] [BEHAVIOR] [L1] B-07: loop/derive capability_assertion_coverage_missing（retryable:false）→ 路由 wait:human_review
  动作: 从仓库根跑冻结测试 loop-impact-deterministic-route 的 coverage_missing 用例
  预期观察: 下一动作 dispatch 含 'wait:human_review'（Map 覆盖缺口需人补断言，不派 generator-fix）（用例 PASS）
  等待预算: 60s
  留证: vitest 用例输出末 5 行（含 passed）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08171726-kernel-3b150c01/tests/loop-impact-deterministic-route.test.js -t "capability_assertion_coverage_missing"'

- [ ] [BEHAVIOR] [L1] B-08: 回归夹具 run d1360a48（真实 changed_files 含 DoD.md + radius 录制件）→ 新代码 blocked:impact_anchor_missing
  动作: 从仓库根跑冻结测试 diff-gate-regression-d1360a48（录制件注入 evaluateDiffGate，changed_files 取自录制件）
  预期观察: 返回 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files 含 'DoD.md'（旧代码此处为 mapper_stale/retryable:true）（用例 PASS）
  等待预算: 60s
  留证: vitest 用例输出末 5 行（含 passed）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08171726-kernel-3b150c01/tests/diff-gate-regression-d1360a48.test.js'

- [ ] [BEHAVIOR] [L2] B-09: Final E2E — scratch 库 orchestrator_decision_log 落确定性 blocked 行（数据写入类，带时间窗，INV-5）[接缝×2]
  动作: 跑 Final E2E harness（迁移 scratch 库 → 真 impactGate 链 + 真 appendHop，注入 mapper 录制件），返回本次 run_id
  预期观察: orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空（5 分钟时间窗内）
  等待预算: 60s
  留证: psql 查询输出（命中一行）
  Test: manual:bash -c 'RID=$(node sprints/08171726-kernel-3b150c01/e2e/impact-gate-e2e.mjs) && psql "$DB_URL" -tAc "SELECT 1 FROM orchestrator_decision_log WHERE run_id='"'"'$RID'"'"' AND action='"'"'spawn:evaluator'"'"' AND gate_verdict='"'"'deny:impact:impact_anchor_missing'"'"' AND detail->'"'"'impact_gate'"'"'->>'"'"'retryable'"'"'='"'"'false'"'"' AND jsonb_array_length(COALESCE(detail->'"'"'impact_gate'"'"'->'"'"'unclaimed_files'"'"','"'"'[]'"'"'::jsonb))>=1 AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | grep -q 1'

## Invariant（铁律）覆盖映射

- INV-1 确定性结论不得标可重试 / 真新鲜度仍可重试 — 由 B-01/B-02/B-04（retryable=false）+ B-03（retryable=true）覆盖
- INV-2 失败不静默：未知 reason_code fail-closed，禁 warning 降级放行 — 由 B-04 覆盖
- INV-3 reason 保真 + 证据入决策日志：gateReceipt 透传 detail，决策日志含 unclaimed_files — 由 B-05/B-06/B-09 覆盖
- INV-5 真环境验证才算 done：Final E2E 真 Postgres 落行 — 由 B-09 覆盖
- INV [禁写死环境假设值] — N/A：本 sprint 无环境假设值（DB 用 $DB_URL，mapper 用注入录制件）
- INV [测试默认多租户] / [凭据安全] / [日志脱敏] / [端点鉴权] / [租户隔离] — N/A：不新增租户身份/凭据/日志敏感字段/端点

- [ ] [BEHAVIOR] [L1] INV-4: status/reason 枚举全仓核对——本 sprint 不新增孤立 reason 字面值
  动作: git grep 三个 reason 字面值确认均已存在于既有代码/radius
  预期观察: mapper_contract_invalid / impact_anchor_missing / capability_assertion_coverage_missing 均在 packages/brain/src 内已存在（非本 sprint 新造枚举）
  等待预算: 0s
  留证: git grep 命中计数输出（OK 行）
  Test: manual:bash -c 'node -e "const {execFileSync}=require(\"child_process\");const out=execFileSync(\"git\",[\"grep\",\"-hoE\",\"mapper_contract_invalid|impact_anchor_missing|capability_assertion_coverage_missing\",\"--\",\"packages/brain/src\"]).toString();if(out.trim().length===0)process.exit(1);console.log(\"OK\")"'

## DevGate（Brain 改动前置门禁，evaluator/CI 执行）

- [ ] [BEHAVIOR] [L1] DevGate facts-check
  动作: node scripts/facts-check.mjs
  预期观察: exit 0（DEFINITION.md 与代码一致）
  等待预算: 30s
  留证: 命令 stdout 末 5 行
  Test: manual:bash -c 'node scripts/facts-check.mjs'

- [ ] [BEHAVIOR] [L1] DevGate version-sync
  动作: bash scripts/check-version-sync.sh
  预期观察: exit 0（四处版本 = 1.273.72）
  等待预算: 30s
  留证: 命令 stdout 末 5 行
  Test: manual:bash -c 'bash scripts/check-version-sync.sh'

- [ ] [BEHAVIOR] [L1] DevGate DoD→Test 映射
  动作: node packages/quality/scripts/devgate/check-dod-mapping.cjs
  预期观察: exit 0
  等待预算: 30s
  留证: 命令 stdout 末 5 行
  Test: manual:bash -c 'node packages/quality/scripts/devgate/check-dod-mapping.cjs'
