---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传确定性 reason_code + fail-closed 出口（r19 / r23）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a `mapper_stale` 分支——透传
`freshness.reason_code` + 按是否确定性判定 `retryable`（fail-closed 终态）；对应 diff-gate.test.js 回归。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤3a 分支读取并透传 freshness.reason_code
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/reason_code/.test(c)||!/retryable:\s*false/.test(c))process.exit(1)"
  期望: exit 0（源码含 reason_code 透传 + 存在 retryable:false 终态出口）

- [ ] [ARTIFACT] diff-gate.test.js 含步骤3a 确定性 reason_code 回归 describe
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('步骤3a')||!c.includes('projection_revision_mismatch'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 确定性 stale（reason_code 非空）透传真实 code 并 fail-closed retryable=false
  动作: 注入 mapClient 返回 `{freshness:{status:'stale',reason_code:'projection_revision_mismatch'}}`，调用 evaluateDiffGate
  预期观察: verdict.reason==verdict.reason_code=='projection_revision_mismatch' 且 verdict.retryable===false 且 gate=='impact_unknown'
  等待预算: 0s（同步单测）
  留证: /tmp/b01.log 末 5 行（含 passed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "确定性 stale 结论透传 reason_code") > /tmp/b01.log 2>&1; grep -Eq "1 passed" /tmp/b01.log || { echo FAIL; tail -5 /tmp/b01.log; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L1] B-02: unknown status 携带 reason_code 同样透传并 fail-closed
  动作: 注入 mapClient 返回 `{freshness:{status:'unknown',reason_code:'map_scope_undeclared'}}`，调用 evaluateDiffGate
  预期观察: verdict.reason=='map_scope_undeclared' 且 verdict.retryable===false（非 fresh 的任意状态只要带 code 均透传）
  等待预算: 0s
  留证: /tmp/b02.log 末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "unknown status 携带 reason_code") > /tmp/b02.log 2>&1; grep -Eq "1 passed" /tmp/b02.log || { echo FAIL; tail -5 /tmp/b02.log; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L1] B-03: 瞬时 stale（reason_code 为 null）保留 mapper_stale retryable=true 不误杀
  动作: 注入 mapClient 返回 `{freshness:{status:'stale',reason_code:null}}`，调用 evaluateDiffGate
  预期观察: verdict.reason=='mapper_stale' 且 verdict.retryable===true（可恢复场景不被误杀）
  等待预算: 0s
  留证: /tmp/b03.log 末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "瞬时 stale 无 reason_code 保留 mapper_stale") > /tmp/b03.log 2>&1; grep -Eq "1 passed" /tmp/b03.log || { echo FAIL; tail -5 /tmp/b03.log; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L1] B-04: freshness 完全缺失视为瞬时 stale retryable=true
  动作: 注入 mapClient 返回不含 freshness 的对象 `{affected_nodes:[]}`，调用 evaluateDiffGate
  预期观察: verdict.reason=='mapper_stale' 且 verdict.retryable===true（缺字段不当确定性误杀）
  等待预算: 0s
  留证: /tmp/b04.log 末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "freshness 完全缺失视为瞬时 stale") > /tmp/b04.log 2>&1; grep -Eq "1 passed" /tmp/b04.log || { echo FAIL; tail -5 /tmp/b04.log; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L1] B-05: Mapper 抛错仍走 mapper_unavailable retryable=true 与确定性 stale 区分
  动作: 注入 mapClient throw，调用 evaluateDiffGate
  预期观察: verdict.reason=='mapper_unavailable' 且 verdict.retryable===true（不可达 ≠ 确定性 stale，不被 fail-closed 误锁）
  等待预算: 0s
  留证: /tmp/b05.log 末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "Mapper 抛错仍为 mapper_unavailable") > /tmp/b05.log 2>&1; grep -Eq "1 passed" /tmp/b05.log || { echo FAIL; tail -5 /tmp/b05.log; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L1] INV-1 [fail-closed]: 确定性不可判定结论返回 impact_unknown 且 retryable=false，绝不假绿放行
  动作: 复跑确定性 stale 用例（B-01 场景），断言不落入 pass/extend
  预期观察: gate=='impact_unknown' 且 retryable===false（无任何 pass/extend 假绿路径）
  等待预算: 0s
  留证: /tmp/inv1.log 末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "确定性 stale 结论透传 reason_code") > /tmp/inv1.log 2>&1; grep -Eq "1 passed" /tmp/inv1.log || { echo FAIL; tail -5 /tmp/inv1.log; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L1] INV-2 [不误杀]: 只有确定性 code 才 retryable=false；真·瞬时 stale 必须保留 retryable=true
  动作: 复跑两条「不误杀」用例（瞬时 reason_code=null + freshness 缺失）
  预期观察: 两用例均 verdict.retryable===true（可恢复场景零误杀）
  等待预算: 0s
  留证: /tmp/inv2.log 末 5 行
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "不误杀") > /tmp/inv2.log 2>&1; grep -Eq "2 passed" /tmp/inv2.log || { echo FAIL; tail -5 /tmp/inv2.log; exit 1; }; echo OK'
