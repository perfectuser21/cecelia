[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'postgres',
  port: 5432,
  database: 'acceptance_d462c596040d2da2_scratch',
  user: 'attempt_c76a7f836cdb023d',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts  (9 tests | 4 failed) 13ms
   ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠） > revision_mismatch 确定性 retryable=false（base_sha 冻结下重试不自愈）
     → expected true to be false // Object.is equality
   ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠） > manifest_digest_mismatch 确定性 retryable=false
     → expected true to be false // Object.is equality
   ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠） > projection_digest_mismatch 确定性 retryable=false
     → expected true to be false // Object.is equality
   ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 语义一致铁律：diff-gate ↔ structure-gate 同一 reason_code 同一 retryable 分桶 > 语义一致：两端 revision_mismatch 均确定性 retryable=false
     → expected true to be false // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠） > revision_mismatch 确定性 retryable=false（base_sha 冻结下重试不自愈）
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts:51:30
     49|     expect(result.gate).toBe('impact_unknown');
     50|     expect(result.reason).toBe('revision_mismatch'); // 原样透传，非 m…
     51|     expect(result.retryable).toBe(false);
       |                              ^
     52|   });
     53| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠） > manifest_digest_mismatch 确定性 retryable=false
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts:70:30
     68|     expect(result.gate).toBe('impact_unknown');
     69|     expect(result.reason).toBe('manifest_digest_mismatch');
     70|     expect(result.retryable).toBe(false);
       |                              ^
     71|   });
     72| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > 确定性 Map 结论 → fail-closed（retryable=false，具体 reason_code 不折叠） > projection_digest_mismatch 确定性 retryable=false
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts:90:30
     88|     expect(result.gate).toBe('impact_unknown');
     89|     expect(result.reason).toBe('projection_digest_mismatch');
     90|     expect(result.retryable).toBe(false);
       |                              ^
     91|   });
