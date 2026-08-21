# Red 证据 — Sprint 08220415-kernel-99e5425b

实现未落地时，冻结回归测试全红（5 failed），符合 TDD Red 预期：

```
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'postgres',
  port: 5432,
  database: 'acceptance_8755d9011f4c2cf8_scratch',
  user: 'attempt_76ab98db42fb6ca9',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 × sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-01 确定性 reason_code no_anchor 走 fail-closed 出口 retryable=false
   → expected undefined to be 'no_anchor' // Object.is equality
 × sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-02 瞬时白名单 fact_snapshot_stale 与 projection_revision_missing 保留 retryable=true
   → expected undefined to be 'fact_snapshot_stale' // Object.is equality
 × sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-03 freshness 缺失 reason_code=null 保留 retryable=true
   → expected undefined to be null
 × sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-04 gateReceipt diff deny 标签透传具体 reason_code 不再裸 mapper_stale
   → expected undefined to be 'no_anchor' // Object.is equality
 × sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-05 未知 reason_code 归确定性 fail-closed retryable=false
   → expected undefined to be 'some_unknown_code' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-01 确定性 reason_code no_anchor 走 fail-closed 出口 retryable=false
AssertionError: expected undefined to be 'no_anchor' // Object.is equality

- Expected: 
"no_anchor"

+ Received: 
undefined

 ❯ sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts:66:32
     64|     expect(result.gate).toBe('impact_unknown');
     65|     // 透传具体码，不再丢弃成裸 mapper_stale
     66|     expect(result.reason_code).toBe('no_anchor');
       |                                ^
     67|     // 确定性码 fail-closed：停止无限重试
     68|     expect(result.retryable).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-02 瞬时白名单 fact_snapshot_stale 与 projection_revision_missing 保留 retryable=true
AssertionError: expected undefined to be 'fact_snapshot_stale' // Object.is equality

- Expected: 
"fact_snapshot_stale"

+ Received: 
undefined

 ❯ sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts:82:34
     80|       });
     81|       expect(result.gate).toBe('impact_unknown');
     82|       expect(result.reason_code).toBe(code);
       |                                  ^
     83|       // 瞬时白名单：保留可重试
     84|       expect(result.retryable).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

 FAIL  sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-03 freshness 缺失 reason_code=null 保留 retryable=true
AssertionError: expected undefined to be null
 ❯ sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts:98:32
     96|     });
     97|     expect(result.gate).toBe('impact_unknown');
     98|     expect(result.reason_code).toBeNull();
       |                                ^
     99|     // freshness 缺失保守当瞬时
    100|     expect(result.retryable).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts > Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 > B-04 gateReceipt diff deny 标签透传具体 reason_code 不再裸 mapper_stale
AssertionError: expected undefined to be 'no_anchor' // Object.is equality
```
