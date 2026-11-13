# DoD：默认PR资源Canary与Brain重复测试清退

- [x] [BEHAVIOR] 无关PR不运行资源专项；Linux相关输入触发对应专项；未启用AppServer与旧attempt只显式按需运行。
  Test: manual:node --test scripts/ci/__tests__/basic-resource-canary-scope.test.mjs
- [x] [BEHAVIOR] 最终门严格核对专项计划，必要专项的失败、取消、缺失或未知不可通过；合法不适用有可验证计划。
  Test: manual:node --test scripts/ci/__tests__/basic-results.test.mjs
- [x] [BEHAVIOR] 重复静态断言清退，真实路由、默认不启旧timer及独有接线保护保留。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/legacy-notion-push-scheduler.test.js
- [x] [BEHAVIOR] 事实/版本/来源/防复活完整组一致，历史组不变，拒绝篡改或跨组混配。
  Test: manual:node scripts/facts-check.mjs
- [ ] [BEHAVIOR] 当前HEAD完整PR验收通过并真实合并，事实、证据、actor准确写回。
  Test: manual:curl -sf http://localhost:5221/api/brain/tasks/0114fd58-946b-4fea-b96f-505b731c22ed
