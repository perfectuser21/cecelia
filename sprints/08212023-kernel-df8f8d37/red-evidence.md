# Red 证据 — Sprint 08212023-kernel-df8f8d37

冻结合同测试在实现前必红（TESTS_ALREADY_PRESENT，测试随 contract import 预置）。

## vitest 统计（sprints/.../diff-gate-reason-code.test.js）
```
failed 5 | passed 1 | total 6（符合合同 Test Contract 预期红证据：修复前 5 failed | 1 passed）
根因：3a 分支仅返回 {reason:'mapper_stale',retryable:true} 无 reason_code 字段；gateReceipt 未导出/未透传 reason_code。
```

## dod-assert.mjs 场景（node 断言真实 gate 代码）
```
全部 exit 1 —— SyntaxError: harness-gates.js does not provide an export named 'gateReceipt'
```
