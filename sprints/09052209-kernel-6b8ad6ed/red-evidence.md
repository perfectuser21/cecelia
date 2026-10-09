# Red Evidence — Crystal 结晶判官 (TDD Red)

合同冻结测试已随 contract import 存在于当前分支（fleet/frozen 常态），不重复 checkout。
Red 验证：实现模块 packages/brain/src/crystal/{verdict-engine,evidence,grids}.js 尚不存在 → import 失败 → 全部 FAIL。

```

 FAIL  sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts [ sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts ]
Error: Failed to load url ../../../packages/brain/src/crystal/verdict-engine.js (resolved id: ../../../packages/brain/src/crystal/verdict-engine.js) in /workspace/sprints/09052209-kernel-6b8ad6ed/tests/crystal-verdict.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Start at  16:52:48
   Duration  444ms (transform 59ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 126ms)

```
