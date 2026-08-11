[Red 证据] coding 路由收归 kernel — 2 通道均全红（实现未写）

① brain-unit 通道 (packages/brain/src/__tests__/coding-route-kernel.test.js)
   npx vitest run src/__tests__/coding-route-kernel.test.js
   → total 7 / passed 2 / failed 5
   失败：classifyCodeChange is not a function ×4（纯分类）+ expected 'dev' to be 'harness_initiative' ×1（reroute 未实现）
   现绿 2 例为「行为不变」guard（research 不打标 / research task_type 不变）——实现前即为真。

② Sprint Tests 通道 (sprints/08111158-kernel-89d15e73/tests/coding-route-kernel.test.js, root config)
   npx vitest run sprints/08111158-kernel-89d15e73/tests/coding-route-kernel.test.js
   → total 4 / passed 0 / failed 4
   失败：classifyCodeChange is not a function（task-router 未导出分类 API）
