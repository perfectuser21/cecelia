# Red 证据 — Diff Impact Gate 步骤 3a reason_code 透传

命令: npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js
结果: 3 failed | 1 passed（前 3 条新行为红，第 4 条 gate 不变量绿）——与合同 Test Contract 预期红证据一致

```
+ Received

- false
+ true

 ❯ sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js:57:27
     55|       const r = await runGate(missing);
     56|       expect(r.reason).toBe('mapper_stale');
     57|       expect(r.retryable).toBe(false);
       |                           ^
     58|     }
     59|     // stale + 缺 reason_code → 保底 reason=mapper_stale，retryable 按…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
   Start at  03:08:10
   Duration  770ms (transform 155ms, setup 0ms, collect 360ms, tests 10ms, environment 0ms, prepare 108ms)

```
