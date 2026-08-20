# TDD Red 证据 — step 3a reason_code 透传 + fail-closed 出口

在未实现修复前，永久回归测试 packages/brain/src/impact-contract/__tests__/diff-gate.test.js 的 step 3a 新增用例执行结果：

```
 ❯ src/impact-contract/__tests__/diff-gate.test.js  (25 tests | 3 failed | 20 skipped) 15ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/impact-contract/__tests__/diff-gate.test.js > FR-4 Diff Impact Gate > step 3a — reason_code 透传 + 确定性 fail-closed 出口 > step 3a: freshness.status unknown 透传 reason_code 且 retryable false
 FAIL  src/impact-contract/__tests__/diff-gate.test.js > FR-4 Diff Impact Gate > step 3a — reason_code 透传 + 确定性 fail-closed 出口 > step 3a: freshness.status stale 透传 reason_code 且 retryable true
 FAIL  src/impact-contract/__tests__/diff-gate.test.js > FR-4 Diff Impact Gate > step 3a — reason_code 透传 + 确定性 fail-closed 出口 > step 3a: unknown 缺 reason_code 落确定性占位且 retryable false
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed | 20 skipped (25)
```

3 failed（需修复）：unknown 透传 reason_code、stale 透传 reason_code、unknown 缺 reason_code 落占位；
2 passed（既有 fail-closed 护栏，防退化）：stale 缺 reason_code 透传 null、非 fresh gate 恒 impact_unknown。
