[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'postgres',
  port: 5432,
  database: 'acceptance_cc3df07005aba009_scratch',
  user: 'attempt_0fbeb7808cbcb465',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts  (5 tests | 3 failed) 9ms
   ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts > diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口 > 确定性 reason_code 透传且 retryable=false（fail-closed 终态，不再空转）
     → expected 'mapper_stale' to be 'projection_revision_mismatch' // Object.is equality
   ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts > diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口 > 确定性 reason_code 也回填到 reason_code 字段（透传证据）
     → expected 'mapper_stale' to be 'map_unavailable' // Object.is equality
   ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts > diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口 > 确定性 reason_code 存在但 Mapper 未给 retryable 字段时，Gate 仍判 retryable=false（有 reason_code ⇒ 非重试）
     → expected 'mapper_stale' to be 'provider_denied' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts > diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口 > 确定性 reason_code 透传且 retryable=false（fail-closed 终态，不再空转）
AssertionError: expected 'mapper_stale' to be 'projection_revision_mismatch' // Object.is equality

- Expected
+ Received

- projection_revision_mismatch
+ mapper_stale

 ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts:57:27
     55|     expect(result.gate).toBe('impact_unknown');
     56|     // 根因修复：reason 透传 Mapper 原始 reason_code，不再折叠成 'mapp…
     57|     expect(result.reason).toBe('projection_revision_mismatch');
       |                           ^
     58|     // 确定性结论 ⇒ 非重试终态
     59|     expect(result.retryable).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts > diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口 > 确定性 reason_code 也回填到 reason_code 字段（透传证据）
AssertionError: expected 'mapper_stale' to be 'map_unavailable' // Object.is equality

- Expected
+ Received

- map_unavailable
+ mapper_stale

 ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts:77:27
     75|     });
     76| 
     77|     expect(result.reason).toBe('map_unavailable');
       |                           ^
     78|     expect(result.reason_code).toBe('map_unavailable');
     79|     expect(result.retryable).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts > diff-gate 步骤 3a：reason_code 透传 + fail-closed 出口 > 确定性 reason_code 存在但 Mapper 未给 retryable 字段时，Gate 仍判 retryable=false（有 reason_code ⇒ 非重试）
AssertionError: expected 'mapper_stale' to be 'provider_denied' // Object.is equality

- Expected
+ Received

- provider_denied
+ mapper_stale

 ❯ sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts:139:27
    137|     });
    138| 
    139|     expect(result.reason).toBe('provider_denied');
       |                           ^
    140|     expect(result.retryable).toBe(false);
    141|   });

