[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m
JSON report written to /tmp/red-report.json
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m
 RUN  v1.6.1 /Users/administrator/worktrees/task-097e589d/session-d5388c0f
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  sprints/07221126-relay-097e589d/tests/relay-smoke.test.ts [ sprints/07221126-relay-097e589d/tests/relay-smoke.test.ts ]
Error: Failed to load url ../../../packages/brain/src/utils/relay-smoke.js (resolved id: ../../../packages/brain/src/utils/relay-smoke.js) in /Users/administrator/worktrees/task-097e589d/session-d5388c0f/sprints/07221126-relay-097e589d/tests/relay-smoke.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  no tests
   Start at  20:55:48
   Duration  109ms (transform 11ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 26ms)

[red] CI 常跑副本 packages/brain/src/utils/relay-smoke.test.js 同样红：
 FAIL  src/utils/relay-smoke.test.js [ src/utils/relay-smoke.test.js ]
Error: Failed to load url ./relay-smoke.js (resolved id: ./relay-smoke.js) in /Users/administrator/worktrees/task-097e589d/session-d5388c0f/packages/brain/src/utils/relay-smoke.test.js. Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
