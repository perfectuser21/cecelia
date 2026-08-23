[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 × sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 2 轮 generator-fix 后 deadline 顺延到最新 fix 原点的 created_at + timeout（RED→GREEN 核心，禁用 stale persisted detail）
   → expected { …(2) } to deeply equal { …(2) }
 × sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 顺延超上限：7 轮 generator-fix deadline 冻结在第 6 次顺延原点，第 7 次不再顺延
   → expected '2026-08-01T00:00:00.000Z' to be '2026-08-01T01:40:00.000Z' // Object.is equality
 × sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 边界：恰好 6 轮 generator-fix 仍顺延到第 6 次原点（上限内不冻结）
   → expected '2026-08-01T00:00:00.000Z' to be '2026-08-01T01:40:00.000Z' // Object.is equality
 ✓ sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 无 generator-fix 行时窗口仍以首 generator 原点算（回归守恒，语义不变）
 ✓ sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > fail-closed 守恒：非 generator 系且无有效 origin 仍抛 validation_clock_required

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 2 轮 generator-fix 后 deadline 顺延到最新 fix 原点的 created_at + timeout（RED→GREEN 核心，禁用 stale persisted detail）
AssertionError: expected { …(2) } to deeply equal { …(2) }

- Expected
+ Received

  Object {
-   "deadline_at": "2026-08-01T04:16:40.000Z",
-   "pipeline_started_at": "2026-08-01T02:46:40.000Z",
+   "deadline_at": "2026-08-01T01:30:00.000Z",
+   "pipeline_started_at": "2026-08-01T00:00:00.000Z",
  }

 ❯ sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js:59:19
     57|       timeoutSeconds: TIMEOUT,
     58|     });
     59|     expect(clock).toEqual({
       |                   ^
     60|       pipeline_started_at: iso(10000),
     61|       deadline_at: iso(10000 + TIMEOUT),

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 顺延超上限：7 轮 generator-fix deadline 冻结在第 6 次顺延原点，第 7 次不再顺延
AssertionError: expected '2026-08-01T00:00:00.000Z' to be '2026-08-01T01:40:00.000Z' // Object.is equality

- Expected
+ Received

- 2026-08-01T01:40:00.000Z
+ 2026-08-01T00:00:00.000Z

 ❯ sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js:75:39
     73|     });
     74|     // 第 6 次 fix 在 T0+6000（第 7 次 T0+7000 被上限截断，不作原点）
     75|     expect(clock.pipeline_started_at).toBe(iso(6000));
       |                                       ^
     76|     expect(clock.deadline_at).toBe(iso(6000 + TIMEOUT));
     77|     expect(clock.deadline_at).not.toBe(iso(7000 + TIMEOUT));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js > resolveValidationClock 按 fix 轮有界顺延 [F1 step3] > 边界：恰好 6 轮 generator-fix 仍顺延到第 6 次原点（上限内不冻结）
AssertionError: expected '2026-08-01T00:00:00.000Z' to be '2026-08-01T01:40:00.000Z' // Object.is equality

- Expected
+ Received

- 2026-08-01T01:40:00.000Z
+ 2026-08-01T00:00:00.000Z

 ❯ sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js:89:39
     87|       timeoutSeconds: TIMEOUT,
     88|     });
     89|     expect(clock.pipeline_started_at).toBe(iso(6000));
       |                                       ^
     90|     expect(clock.deadline_at).toBe(iso(6000 + TIMEOUT));
     91|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
   Start at  11:32:02
   Duration  146ms (transform 17ms, setup 0ms, collect 10ms, tests 6ms, environment 0ms, prepare 46ms)
