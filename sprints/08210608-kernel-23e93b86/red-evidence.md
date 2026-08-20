# Red 证据 — Diff Impact Gate step 3a 非 fresh 出口语义分流

命令: npx vitest run --no-cache sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js

```
     → expected 'mapper_stale' to be 'capability_not_in_active_projection' // Object.is equality
     → expected 'mapper_stale' to be 'mapper_unknown' // Object.is equality
     → expected 'mapper_stale' to be 'projection_snapshot_expired' // Object.is equality
     → expected true to be false // Object.is equality
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — step 3a 非 fresh 出口语义分流 [BEHAVIOR] > unknown 状态透传 reason_code 且 retryable false（确定性终局出口）
AssertionError: expected 'mapper_stale' to be 'capability_not_in_active_projection' // Object.is equality
 FAIL  sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — step 3a 非 fresh 出口语义分流 [BEHAVIOR] > unknown 状态无 reason_code 回退 mapper_unknown 且 retryable false
AssertionError: expected 'mapper_stale' to be 'mapper_unknown' // Object.is equality
 FAIL  sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — step 3a 非 fresh 出口语义分流 [BEHAVIOR] > stale 状态透传 reason_code 且 retryable true（瞬态可重试）
AssertionError: expected 'mapper_stale' to be 'projection_snapshot_expired' // Object.is equality
 FAIL  sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — step 3a 非 fresh 出口语义分流 [BEHAVIOR] > freshness 缺失 fail-closed 且 retryable false（不假绿）
AssertionError: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

结论: 4 failed | 2 passed（unknown 透传 / unknown 回退 / stale 透传 / freshness 缺失 均红；stale 无 code 回退 + 既有出口守卫 baseline 恰好绿），符合合同 Red 预测。
