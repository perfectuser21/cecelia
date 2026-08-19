[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'postgres',
  port: 5432,
  database: 'acceptance_a7e1b3afe30512b4_scratch',
  user: 'attempt_99087a3eb1fa1eec',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js  (4 tests | 4 failed) 11ms
   ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 瞬态 stale：透传具体 reason_code 且 retryable:true（非 mapper_stale） [B-01]
     → expected 'mapper_stale' to be 'fact_snapshot_stale' // Object.is equality
   ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 确定性 unknown：fail-closed retryable:false 且透传具体 reason_code [B-02]
     → expected true to be false // Object.is equality
   ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 边界：缺 reason_code / 未知 status → fail-closed 占位 unknown 不回退 mapper_stale [B-03]
     → expected true to be false // Object.is equality
   ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 禁 mapper_stale 残留：所有非 fresh 分支 reason 绝不等于 mapper_stale [B-04]
     → expected 'mapper_stale' not to be 'mapper_stale' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 瞬态 stale：透传具体 reason_code 且 retryable:true（非 mapper_stale） [B-01]
AssertionError: expected 'mapper_stale' to be 'fact_snapshot_stale' // Object.is equality

- Expected
+ Received

- fact_snapshot_stale
+ mapper_stale

 ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js:40:27
     38|     expect(result.gate).toBe('impact_unknown');
     39|     expect(result.retryable).toBe(true);
     40|     expect(result.reason).toBe('fact_snapshot_stale');
       |                           ^
     41|     expect(result.reason).not.toBe('mapper_stale');
     42|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 确定性 unknown：fail-closed retryable:false 且透传具体 reason_code [B-02]
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js:52:30
     50|     });
     51|     expect(result.gate).toBe('impact_unknown');
     52|     expect(result.retryable).toBe(false);
       |                              ^
     53|     expect(result.reason).toBe('impact_unknown');
     54|     expect(result.reason).not.toBe('mapper_stale');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js > Diff Impact Gate — reason_code 透传 + 确定性 unknown fail-closed > 边界：缺 reason_code / 未知 status → fail-closed 占位 unknown 不回退 mapper_stale [B-03]
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js:66:26
     64|     });
     65|     expect(r1.gate).toBe('impact_unknown');
     66|     expect(r1.retryable).toBe(false);
       |                          ^
     67|     expect(r1.reason).toBe('unknown');
