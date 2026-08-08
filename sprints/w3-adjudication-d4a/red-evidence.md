# Red 证据 — commit 1（合同测试落位后、实现前）

canonical Red commit: f98e2362ac1296e26a72cd5bc9416071f7faff49

## 测试文件

`sprints/w3-adjudication-d4a/tests/d4-adjudication-contract.test.js`

## vitest（合同测试落位副本）

```
Test Files  1 failed (1)
     Tests  34 failed | 0 passed (34)
```

与合同 Test Contract 表注起草时红证据（34 failed）逐字一致：

- FAIL: [BEHAVIOR-1] 缺 verdict 字段 → HTTP 400（端点未实现，createAcceptanceInternalRouter = null）
- FAIL: [BEHAVIOR-1] 缺 by 字段 → HTTP 400
- FAIL: [BEHAVIOR-1] 缺 reason 字段 → HTTP 400
- FAIL: [BEHAVIOR-1] verdict 非法值（非绿/红）→ HTTP 400
- FAIL: [BEHAVIOR-1] 合法请求 → HTTP 200，adjudication 含四字段
- FAIL: [BEHAVIOR-2] scenario_class=unverifiable_this_version → 不建 hard_green_p0 任务
- FAIL: [BEHAVIOR-2] scenario_class 非 unverifiable → 建 hard_green_p0 任务
- FAIL: [BEHAVIOR-3] ai_status=dumb → 建 infra_error P0，不建 bug/trace/fission
- FAIL: [BEHAVIOR-3] 非绿格 > 1/3 → 建 fission P0，不建 bug/trace
- FAIL: [BEHAVIOR-3] 正常分流（有红格）→ bug 任务 = 1，trace 任务 ≤ 1
- FAIL: [BEHAVIOR-4] status=adjudicated → PATCH /abandon → HTTP 409
- FAIL: [BEHAVIOR-4] status=stale → PATCH /abandon → HTTP 409
- FAIL: [BEHAVIOR-4] status=pending → PATCH /abandon → HTTP 200
- FAIL: [BEHAVIOR-4] status=in_review → PATCH /abandon → HTTP 200
- FAIL: [BEHAVIOR-4] status=expired → PATCH /abandon → HTTP 200
- FAIL: [BEHAVIOR-5] 同 run_key+bucket 已存在任务 → SAVEPOINT 捕获冲突，外层事务正常提交
- FAIL: [BEHAVIOR-5] 两个不同 bucket 各自独立建任务（查重按 bucket 维度区分）
（及其余 17 个相关 sub-case，合计 34 个失败）

## 失败根因

D4 功能代码（`packages/brain/src/routes/acceptance.js` 中 `createAcceptanceInternalRouter` 导出）
在 Red 阶段尚未实现，测试入口 dynamic import 捕获错误后设 `createAcceptanceInternalRouter = null`，
`makeApp()` 抛出 "尚未实现" 错误，导致全部 34 个 it() 失败。
