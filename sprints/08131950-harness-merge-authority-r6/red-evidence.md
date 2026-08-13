===== RED-A (should-auto-merge fail-open → 4 FAIL 预期) =====
PASS: 受信 entitlement 精确绑定 repo+PR+head_sha → MERGE
FAIL: 通用 cp-* 无 entitlement → 默认 SKIP (期望 'SKIP'，实际: MERGE)
FAIL: Brain 不可达 → fail-closed SKIP (期望 'SKIP'，实际: MERGE)
FAIL: 陈旧 head_sha 不匹配 → SKIP (期望 'SKIP'，实际: MERGE)
FAIL: 不受信通道签发 → SKIP (期望 'SKIP'，实际: MERGE)
PASS: feat(harness): → 跳过通用 auto-merge
PASS: 非 cp-* 分支 → SKIP

Results: PASS=3 FAIL=4

===== RED-B + RED-C (vitest：12 failed / 2 passed 预期) =====
     61|     expect(r.phase).toBe('failed');
AssertionError: expected 'done' to be 'failed' // Object.is equality
- failed
     70|     expect(r.phase).toBe('failed');
 Test Files  2 failed (2)
      Tests  12 failed | 2 passed (14)
===== RED-D (无 DB → skip；local_api evaluator 跑) =====
