# Red 证据 — commit 1（合同测试落位后、实现前）

## vitest（合同测试落位副本 packages/brain/src/__tests__/ledger-hygiene-m2-noise.test.js）

```
Test Files  1 failed (1)
     Tests  4 failed | 2 passed (6)
```

与合同 Test Contract 表注起草时红证据（4 failed / 2 passed）逐字一致：
- FAIL: m2 tasks 子查询含 smoke_tag 与守卫自产 [紧急] 前缀排除谓词（现 SQL 无排除谓词）
- FAIL: m2 issues 子查询含自产前缀排除谓词（现 SQL 无排除谓词）
- FAIL: m2 求和不再计入 attribution_harness 子指标（现口径 debt=103 含 harness 极端值）
- FAIL: LEDGER_SELF_ISSUE_PREFIX 与 raiseBreachAlerts 写入 title 同源（常量未导出 → undefined）
- PASS: m2 指标对象 shape 保持（既有行为回归守护，按合同预期绿）
- PASS: debt 骤降不触发击穿且不重置 baseline（既有 evaluateRatchet 语义守护，按合同预期绿）

## 真库差分场景（tests/m2-noise-scenarios.sh，真 cecelia 库）

```
=== scenario: noise ===
DRIFT scenario=noise debt 462 -> 466 (期望 462)
FAIL: 场景 noise 两次尝试均未通过           exit=1
=== scenario: harness-once ===
DRIFT scenario=harness-once debt 462 -> 464 (期望 463)
FAIL: 场景 harness-once 两次尝试均未通过    exit=1
=== scenario: real-miss ===
PASS scenario=real-miss D0=462 D1=463 expect=463   exit=0
=== scenario: issue-real-miss ===
PASS scenario=issue-real-miss D0=462 D1=463 expect=463   exit=0
```

解读（与合同根因逐条对应）：
- noise +4：自产 issue +1、自产 [紧急] task +1、smoke_tag task 被 tasks 与 attribution_harness 双计 +2 —— 三类噪声全部涨账（排除未实现）
- harness-once +2：同一 harness 任务被 tasks / attribution_harness 双重计数（旧口径实证）
- real-miss / issue-real-miss 为「排除不误伤」守护场景，新旧口径均应 +1，红阶段本就通过（合同 Step 5 语义）
