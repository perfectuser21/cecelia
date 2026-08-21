[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'postgres',
  port: 5432,
  database: 'acceptance_60ac0647f0b5b710_scratch',
  user: 'attempt_260ccc90403247b2',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 ❯ sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js  (3 tests | 2 failed) 10ms
   ❯ sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js > Diff Impact Gate — step 3a 非 fresh 分支 reason_code 透传 + fail-closed > 确定性 stale（带 reason_code）→ 透传 reason_code 且 retryable:false（终态收敛）
     → expected undefined to be 'projection_revision_mismatch' // Object.is equality
   ❯ sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js > Diff Impact Gate — step 3a 非 fresh 分支 reason_code 透传 + fail-closed > 确定性 unknown 投影（带未知枚举 reason_code）→ 默认 fail-closed retryable:false
     → expected undefined to be 'some_future_reason_code' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js > Diff Impact Gate — step 3a 非 fresh 分支 reason_code 透传 + fail-closed > 确定性 stale（带 reason_code）→ 透传 reason_code 且 retryable:false（终态收敛）
AssertionError: expected undefined to be 'projection_revision_mismatch' // Object.is equality

- Expected: 
"projection_revision_mismatch"

+ Received: 
undefined

 ❯ sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js:38:32
     36|     expect(result.gate).toBe('impact_unknown');
     37|     // 透传 Mapper 真实 reason_code，不再写死 mapper_stale 掩盖来源
     38|     expect(result.reason_code).toBe('projection_revision_mismatch');
       |                                ^
     39|     // 确定性结论 fail-closed 终态，派发层不再无限重试
     40|     expect(result.retryable).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js > Diff Impact Gate — step 3a 非 fresh 分支 reason_code 透传 + fail-closed > 确定性 unknown 投影（带未知枚举 reason_code）→ 默认 fail-closed retryable:false
AssertionError: expected undefined to be 'some_future_reason_code' // Object.is equality

- Expected: 
"some_future_reason_code"

+ Received: 
undefined

 ❯ sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js:53:32
     51| 
     52|     expect(result.gate).toBe('impact_unknown');
     53|     expect(result.reason_code).toBe('some_future_reason_code');
       |                                ^
     54|     expect(result.retryable).toBe(false);
     55|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  00:42:06
   Duration  762ms (transform 165ms, setup 0ms, collect 391ms, tests 10ms, environment 0ms, prepare 126ms)

