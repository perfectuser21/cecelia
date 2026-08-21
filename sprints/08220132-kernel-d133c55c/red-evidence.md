[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'postgres',
  port: 5432,
  database: 'acceptance_858fb1b3f27a0969_scratch',
  user: 'attempt_a6564dee4e68d13b',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts  (6 tests | 5 failed) 235ms
   ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > 确定性 reason_code fail-closed（capability_not_in_active_projection → retryable=false 且 reason 为具体码）
     → expected 'mapper_stale' to be 'capability_not_in_active_projection' // Object.is equality
   ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > 瞬时 fact_snapshot_stale 保留重试（reason=fact_snapshot_stale 且 retryable=true）
     → expected 'mapper_stale' to be 'fact_snapshot_stale' // Object.is equality
   ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > 瞬时 projection_revision_missing 保留重试（reason=projection_revision_missing 且 retryable=true）
     → expected 'mapper_stale' to be 'projection_revision_missing' // Object.is equality
   ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > 未知 reason_code 默认 fail-closed（未来新增码不在白名单 → retryable=false）
     → expected true to be false // Object.is equality
   ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > gateReceipt 透传具体 reason_code（deny 收据非裸 mapper_stale）
     → expected 'undefined' to be 'function' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > 确定性 reason_code fail-closed（capability_not_in_active_projection → retryable=false 且 reason 为具体码）
AssertionError: expected 'mapper_stale' to be 'capability_not_in_active_projection' // Object.is equality

- Expected
+ Received

- capability_not_in_active_projection
+ mapper_stale

 ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts:32:22
     30|     const r: any = await callGate('capability_not_in_active_projection…
     31|     expect(r.gate).toBe('impact_unknown');
     32|     expect(r.reason).toBe('capability_not_in_active_projection');
       |                      ^
     33|     expect(r.retryable).toBe(false);
     34|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts > Diff Impact Gate 3a — reason_code 透传与确定性 fail-closed > 瞬时 fact_snapshot_stale 保留重试（reason=fact_snapshot_stale 且 retryable=true）
AssertionError: expected 'mapper_stale' to be 'fact_snapshot_stale' // Object.is equality

- Expected
+ Received

- fact_snapshot_stale
+ mapper_stale

 ❯ sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts:39:22
     37|     const r: any = await callGate('fact_snapshot_stale');
     38|     expect(r.gate).toBe('impact_unknown');
