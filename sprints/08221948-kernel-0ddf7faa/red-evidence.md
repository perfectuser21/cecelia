[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js  (5 tests | 4 failed) 15ms
   ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > extends the validation window by one timeout per generator-fix after the anchor hop
     → expected { …(2) } to deeply equal { …(2) }
   ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > extends the validation window by exactly one timeout for a single generator-fix
     → expected { …(2) } to deeply equal { …(2) }
   ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > tolerates a persisted anchor clock already advanced to the extended deadline
     → validation_clock_invalid
   ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > keeps the extended deadline finite and exactly linear for a bounded fix count
     → expected { …(2) } to deeply equal { …(2) }

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > extends the validation window by one timeout per generator-fix after the anchor hop
AssertionError: expected { …(2) } to deeply equal { …(2) }

- Expected
+ Received

  Object {
-   "deadline_at": "2026-08-04T01:02:13.199Z",
+   "deadline_at": "2026-08-03T21:02:13.199Z",
    "pipeline_started_at": "2026-08-03T19:02:13.199Z",
  }

 ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js:37:9
     35|       intentAt: '2026-08-03T21:30:00.000Z',
     36|       timeoutSeconds,
     37|     })).toEqual({
       |         ^
     38|       pipeline_started_at: startedAt,
     39|       deadline_at: twoFixDeadlineAt,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > extends the validation window by exactly one timeout for a single generator-fix
AssertionError: expected { …(2) } to deeply equal { …(2) }

- Expected
+ Received

  Object {
-   "deadline_at": "2026-08-03T23:02:13.199Z",
+   "deadline_at": "2026-08-03T21:02:13.199Z",
    "pipeline_started_at": "2026-08-03T19:02:13.199Z",
  }

 ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js:53:9
     51|       intentAt: '2026-08-03T20:30:00.000Z',
     52|       timeoutSeconds,
     53|     })).toEqual({
       |         ^
     54|       pipeline_started_at: startedAt,
     55|       deadline_at: oneFixDeadlineAt,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > tolerates a persisted anchor clock already advanced to the extended deadline
Error: validation_clock_invalid
 ❯ persistedClock packages/brain/src/orchestrator/validation-clock.js:46:13
     44|       || expected.deadline_at !== new Date(deadlineMs).toISOString()
     45|     ) {
     46|       throw new Error('validation_clock_invalid');
       |             ^
     47|     }
     48|     return expected;
 ❯ Module.resolveValidationClock packages/brain/src/orchestrator/validation-clock.js:72:12
 ❯ sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js:67:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js > resolveValidationClock multi-fix window extension > keeps the extended deadline finite and exactly linear for a bounded fix count
AssertionError: expected { …(2) } to deeply equal { …(2) }

- Expected
+ Received

