# 模拟蓝绿发布回归提速验收

Task: e97be8ae-d610-4f97-abc0-36110db96c1d
GP-Anchor: none(infra)

- [ ] 完整9例及蓝绿切换17例通过，三次探活和两次等待保持。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/bluegreen-green-url.test.js src/__tests__/bluegreen-swap.test.js
- [ ] 稳定探活失败重置、网络模式与生产脚本语义保持。
  Test: manual:bash scripts/__tests__/bluegreen-stable-health.test.sh
- [ ] 修改前后同机完整套件测量，降低连续探活门槛的真实变异必须报红。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/bluegreen-green-url.test.js
- [ ] 完整CI及自动发布成功，生产版本SHA读回一致。
  Test: manual:bash scripts/check-version-sync.sh
