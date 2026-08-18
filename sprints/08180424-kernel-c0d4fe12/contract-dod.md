---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 Map 确定性 reason_code + fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` Step 3a 按 `freshness.status` 分流（unknown 透传 reason_code + retryable:false；stale 维持 mapper_stale + retryable:true）+ 对应回归测试。loop.js 代码不改（现有路由已正确消费 retryable:false），仅加端到端回归护栏。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js Step 3a 按 freshness.status 分流（含 unknown 分支透传 reason_code）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!(c.includes(\"freshness.status\")&&c.includes(\"reason_code\")&&c.includes(\"retryable: false\")))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] Golden Path 回归测试文件存在且断言 unknown→retryable:false
  Test: node -e "const c=require('fs').readFileSync('sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js','utf8');if(!c.includes('capability_not_in_active_projection'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本 · 内嵌 manual: 单行命令 · target_environment=local_api / vitest oracle）

- [ ] [BEHAVIOR] [L2] B-01: Mapper unknown 结论透传 reason_code 且 retryable:false（不再折叠 mapper_stale）
  动作: 注入 mapClient 返回 freshness.status='unknown',reason_code='capability_not_in_active_projection'，真跑真实 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown'、reason/reason_code='capability_not_in_active_projection'、retryable===false、reason!=='mapper_stale'
  等待预算: 0s
  留证: vitest 汇总行（Tests N passed）
  Test: manual:bash -c 'O=$(npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js -t "不再折叠 mapper_stale" 2>&1); echo "$O" | grep -qE "Tests.*[1-9][0-9]* passed" && ! echo "$O" | grep -qE "Tests.*[0-9]+ failed" || { echo "$O" | tail -20; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: 瞬态 stale 语义不变 — 维持 mapper_stale + retryable:true（真自愈路径不受影响）
  动作: 注入 mapClient 返回 freshness.status='stale',reason_code='fact_snapshot_stale'，真跑真实 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown'、reason==='mapper_stale'、retryable===true
  等待预算: 0s
  留证: vitest 汇总行（Tests N passed）
  Test: manual:bash -c 'O=$(npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js -t "维持 mapper_stale" 2>&1); echo "$O" | grep -qE "Tests.*[1-9][0-9]* passed" && ! echo "$O" | grep -qE "Tests.*[0-9]+ failed" || { echo "$O" | tail -20; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 确定性 impact gate（retryable:false）→ loop 走 impact_gate_deterministic 终止出口且不 backoff 空转
  动作: 令 beforeEvaluate 返回 retryable:false 的 impact_unknown receipt（reason_code），真跑 runLoop；对照另一条 stale(retryable:true) 走 infrastructure backoff
  预期观察: exitReason==='impact_gate_deterministic'、finalizeRun reason 以 'impact_gate_deterministic:' 开头、无 backoff sleep 调用；对照条 sleep 被调用（不误入终止）
  等待预算: 0s
  留证: vitest 汇总行（Tests N passed）
  Test: manual:bash -c 'O=$( (cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "impact_gate_deterministic 终止且不 backoff") 2>&1); echo "$O" | grep -qE "Tests.*[1-9][0-9]* passed" && ! echo "$O" | grep -qE "Tests.*[0-9]+ failed" || { echo "$O" | tail -20; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: error path — unknown 但 reason_code 缺失仍 fail-closed（retryable:false，兜底常量，绝不假绿）
  动作: 注入 mapClient 返回 freshness.status='unknown',reason_code=null，真跑真实 evaluateDiffGate
  预期观察: retryable===false、reason 为非空字符串兜底常量（非 undefined/null）、reason!=='mapper_stale'
  等待预算: 0s
  留证: vitest 汇总行（Tests N passed）
  Test: manual:bash -c 'O=$(npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js -t "reason_code 缺失" 2>&1); echo "$O" | grep -qE "Tests.*[1-9][0-9]* passed" && ! echo "$O" | grep -qE "Tests.*[0-9]+ failed" || { echo "$O" | tail -20; exit 1; }'

## Invariant 铁律映射

- [ ] [BEHAVIOR] INV-1 [fail-closed] Mapper 任何不可判定情形均 fail-closed，绝不假绿放行（unknown 缺 reason_code 也 retryable:false）
  Test: manual:bash -c 'O=$(npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js -t "reason_code 缺失" 2>&1); echo "$O" | grep -qE "Tests.*[1-9][0-9]* passed" && ! echo "$O" | grep -qE "Tests.*[0-9]+ failed" || { echo "$O" | tail -20; exit 1; }'

- [ ] [BEHAVIOR] INV-2 [不折叠确定性] Map 确定性 unknown 不得被折叠成瞬态 mapper_stale（reason!=='mapper_stale' 且 retryable===false）
  Test: manual:bash -c 'O=$(npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js -t "不再折叠 mapper_stale" 2>&1); echo "$O" | grep -qE "Tests.*[1-9][0-9]* passed" && ! echo "$O" | grep -qE "Tests.*[0-9]+ failed" || { echo "$O" | tail -20; exit 1; }'

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| unknown 透传 reason_code + fail-closed | `sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js` | 不再折叠 mapper_stale / graph_projection_revision_mismatch / reason_code 缺失 | 改前 3 条 fail（retryable=true）|
| stale 瞬态不变（反向不变量） | `sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js` | 维持 mapper_stale / mapper_unavailable | 改前 green（护栏）|
| diff-gate 单测永久回归 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | unknown→retryable:false / stale→retryable:true 新增用例 | 新增 unknown 用例改前 fail |
| loop 确定性终止不空转 | `packages/brain/src/orchestrator/__tests__/loop.test.js` | impact_gate_deterministic 终止且不 backoff | loop.js 未改 → 护栏（green）|

> 「BEHAVIOR 覆盖」列每个覆盖名均为对应 test/it 名的字面子串（`-t` 过滤命中）。generator 须把新增 diff-gate 用例（unknown/stale）也补进 `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`、把 loop 确定性终止护栏补进 `packages/brain/src/orchestrator/__tests__/loop.test.js`（PRD 预期受影响文件），二者进 brain-unit CI 永久留存；`sprints/.../tests/diff-gate-deterministic.test.js` 进 Sprint Tests CI 永久留存。
