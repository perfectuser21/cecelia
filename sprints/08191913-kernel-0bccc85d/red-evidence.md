# Red 证据 — 实现前合同测试全红（5/5 failed）
 ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts  (5 tests | 5 failed) 8ms
   ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts > Diff Impact Gate 非 fresh 语义分流 [BEHAVIOR] > 瞬态 stale 透传具体 reason_code 且 retryable:true 非 mapper_stale
     → expected undefined to be 'fact_snapshot_stale' // Object.is equality
   ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts > Diff Impact Gate 非 fresh 语义分流 [BEHAVIOR] > 确定性 unknown fail-closed retryable:false 且透传 reason_code
     → expected true to be false // Object.is equality
   ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts > Diff Impact Gate 非 fresh 语义分流 [BEHAVIOR] > 缺 reason_code 时保守：stale→retryable:true fallback；unknown→retryable:false fallback
     → expected true to be false // Object.is equality
   ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts > Structure Gate 与 Diff Gate 同语义分流（跨端一致）[BEHAVIOR] > structure-gate stale 透传 reason_code 且 retryable:true
     → expected 'mapper_stale' to be 'ttl_exceeded' // Object.is equality
   ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts > Structure Gate 与 Diff Gate 同语义分流（跨端一致）[BEHAVIOR] > structure-gate unknown fail-closed retryable:false
     → expected true to be false // Object.is equality
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected undefined to be 'fact_snapshot_stale' // Object.is equality
- Expected: 
+ Received: 
 ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts:17:27
     15|     expect(r.gate).toBe('impact_unknown');
     16|     expect(r.retryable).toBe(true);
     17|     expect(r.reason_code).toBe('fact_snapshot_stale');
     18|     expect(r.reason).not.toBe('mapper_stale');
AssertionError: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
 ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts:24:25
     23|     expect(r.gate).toBe('impact_unknown');
     24|     expect(r.retryable).toBe(false);
     25|     expect(r.reason_code).toBe('impact_unknown');
AssertionError: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
 ❯ sprints/08191913-kernel-0bccc85d/tests/diff-impact-gate-failclosed.test.ts:32:31
     31|     expect(stale.retryable).toBe(true);
     32|     expect(unknown.retryable).toBe(false);
AssertionError: expected 'mapper_stale' to be 'ttl_exceeded' // Object.is equality
- Expected
+ Received

