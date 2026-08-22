[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 × sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js > publisher runner_failure 有界重派，不再 route_unknown > B-01 publisher runner_failure 首次 → 返回 publish 重派而非 route_unknown
   → expected { phase: 'review', …(2) } to match object { phase: 'publish', …(2) }
 ✓ sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js > publisher runner_failure 有界重派，不再 route_unknown > B-02 publisher runner_failure 累计 ≥2 次 → 人审兜底 exhausted（有界，不无限重派）
 ✓ sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js > publisher runner_failure 有界重派，不再 route_unknown > B-03 回归：非 publisher（evaluator）runner_failure 路由完全不变
 ✓ sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js > publisher runner_failure 有界重派，不再 route_unknown > B-04 边界：publisher 普通 failed（无 failure_class）不受本次改动影响，仍判终态

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js > publisher runner_failure 有界重派，不再 route_unknown > B-01 publisher runner_failure 首次 → 返回 publish 重派而非 route_unknown
AssertionError: expected { phase: 'review', …(2) } to match object { phase: 'publish', …(2) }

- Expected
+ Received

  Object {
-   "action": "publish:approved_ref",
-   "phase": "publish",
-   "reason": "callback_runner_failure_retry",
+   "action": "wait:human_review",
+   "phase": "review",
+   "reason": "callback_runner_failure_route_unknown",
  }

 ❯ sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js:52:15
     50|     // RED 证据（未加 publisher 映射时）：reason === 'callback_runner_…
     51|     // GREEN（加映射后）：
     52|     expect(r).toMatchObject({
       |               ^
     53|       phase: 'publish',
     54|       action: 'publish:approved_ref',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
   Start at  00:17:27
   Duration  572ms (transform 111ms, setup 0ms, collect 124ms, tests 16ms, environment 0ms, prepare 159ms)

