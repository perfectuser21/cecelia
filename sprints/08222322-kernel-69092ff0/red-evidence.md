[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 ❯ sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js  (3 tests | 2 failed) 14ms
   ❯ sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js > runner_failure 有界重派按角色窗口化 [BEHAVIOR] > 跨角色 runner_failure 不再互耗额度：evaluator 2 败后 publisher 首败仍可重派
     → expected { phase: 'review', …(2) } to deeply equal { phase: 'publish', …(2) }
   ❯ sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js > runner_failure 有界重派按角色窗口化 [BEHAVIOR] > 缺 role 字段的历史 runner_failure 行不计入当前角色窗口
     → expected { phase: 'review', …(2) } to deeply equal { phase: 'publish', …(2) }

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js > runner_failure 有界重派按角色窗口化 [BEHAVIOR] > 跨角色 runner_failure 不再互耗额度：evaluator 2 败后 publisher 首败仍可重派
AssertionError: expected { phase: 'review', …(2) } to deeply equal { phase: 'publish', …(2) }

- Expected
+ Received

  Object {
-   "action": "publish:approved_ref",
-   "phase": "publish",
-   "reason": "callback_runner_failure_retry",
+   "action": "wait:human_review",
+   "phase": "review",
+   "reason": "callback_runner_failure_exhausted",
  }

 ❯ sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js:76:15
     74|       ],
     75|     }));
     76|     expect(r).toEqual({
       |               ^
     77|       phase: 'publish',
     78|       action: 'publish:approved_ref',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js > runner_failure 有界重派按角色窗口化 [BEHAVIOR] > 缺 role 字段的历史 runner_failure 行不计入当前角色窗口
AssertionError: expected { phase: 'review', …(2) } to deeply equal { phase: 'publish', …(2) }

- Expected
+ Received

  Object {
-   "action": "publish:approved_ref",
-   "phase": "publish",
-   "reason": "callback_runner_failure_retry",
+   "action": "wait:human_review",
+   "phase": "review",
+   "reason": "callback_runner_failure_exhausted",
  }

 ❯ sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js:114:15
    112|       ],
    113|     }));
    114|     expect(r).toEqual({
       |               ^
    115|       phase: 'publish',
    116|       action: 'publish:approved_ref',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  19:28:28
   Duration  539ms (transform 96ms, setup 0ms, collect 113ms, tests 14ms, environment 0ms, prepare 110ms)

