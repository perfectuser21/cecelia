# Red Evidence — Diff/Structure Impact Gate reason_code 透传（r39）

冻结回归测试在实现前的红证据（TESTS_ALREADY_PRESENT 分支，测试随 import contract 已存在）:

```
    142|     expect(r.reason).toBe('fact_snapshot_stale');
       |                      ^
    143|     expect(r.retryable).toBe(true);
    144|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[17/17]⎯

 Test Files  1 failed (1)
      Tests  17 failed | 2 passed (19)
   Start at  11:06:21
   Duration  891ms (transform 191ms, setup 0ms, collect 425ms, tests 25ms, environment 0ms, prepare 155ms)

```
