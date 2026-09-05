# Red Evidence — capability-gate frozen test

目标模块 packages/brain/src/capability-gate.js 尚未实现，冻结测试 import 即失败 → 全部 RED（符合预期）。

```
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 ❯ sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts  (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts [ sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts ]
Error: Failed to load url ../../../packages/brain/src/capability-gate.js (resolved id: ../../../packages/brain/src/capability-gate.js) in /workspace/sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Start at  23:58:31
   Duration  395ms (transform 58ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 127ms)

```
