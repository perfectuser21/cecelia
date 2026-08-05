# Contract DoD: F6修复——capture-triage pending_review 积压清零

**gear**: hotfix
**task_id**: 96a00f17-c04c-45c2-a000-b32aae80b956

## 行为断言（BEHAVIOR）

- [BEHAVIOR] no_journey 分支调用 `updateAtom` 携带 `status: 'parked'`
  - grep 验证: `grep -n "no_journey" packages/brain/src/capture-triage.js | grep "parked"` 有输出
  - manual:bash: cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|no_journey|parked"

- [BEHAVIOR] low_confidence 分支调用 `updateAtom` 携带 `status: 'parked'`
  - grep 验证: `grep -n "low_confidence" packages/brain/src/capture-triage.js | grep "parked"` 有输出
  - manual:bash: cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|low_confidence"

- [BEHAVIOR] gate_fail 分支调用 `updateAtom` 携带 `status: 'parked'`
  - grep 验证: `grep -n "gate_fail" packages/brain/src/capture-triage.js | grep "parked"` 有输出
  - manual:bash: cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|gate_fail"

- [BEHAVIOR] `runCaptureAging` 返回含 `stuck_parked` 字段（number）
  - manual:bash: cd packages/brain && npx vitest run src/__tests__/capture-aging.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|stuck_parked"

- [BEHAVIOR] 晨报 bark message 含 triage_items 段（归并榜单守卫）
  - manual:bash: cd packages/brain && npx vitest run src/__tests__/morning-cockpit-bark.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|triage"

## ARTIFACT 断言

[ARTIFACT] 三个测试文件永久存在于 CI 收集路径
- manual:bash: ls packages/brain/src/__tests__/capture-triage.test.js packages/brain/src/__tests__/capture-aging.test.js packages/brain/src/__tests__/morning-cockpit-bark.test.js

[ARTIFACT] capture-triage.js 三处修改均已落实
- manual:bash: grep -c "status: 'parked'" packages/brain/src/capture-triage.js

## 全量单元测试

manual:bash: cd packages/brain && npx vitest run --reporter=verbose src/__tests__/capture-triage.test.js src/__tests__/capture-aging.test.js src/__tests__/morning-cockpit-bark.test.js 2>&1 | tail -20
