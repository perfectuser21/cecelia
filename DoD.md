# CI 工具准备、分片均衡及旧检查清退验收

Task: 98ffde55-541b-458b-985f-11f5213c742d
GP-Anchor: none(infra)

- [ ] 主机工具按组件实际依赖准备，未知组件及安装失败拒绝通过；六个 Brain 分片与所有原专项检查均保留执行入口。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] 三份回调业务测试消除重复实等，保留原业务断言；真实冷却时长及等待次序仍由已收集专项回归约束。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/callback-needs-fix-rounds.test.js src/__tests__/suggestion-callback-contract.test.js src/__tests__/callback-coding-pathway-cleanup.test.js src/__tests__/callback-cooldown.test.js src/__tests__/callback-resilience.test.js
- [ ] 旧自动改版本 bot 及其专属测试清退，完整 manifest、冻结来源和历史基线兼容仍有真实回归。
  Test: manual:npm test --workspace packages/brain -- scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs scripts/ci/__tests__/implementation-auxiliary-read-reuse.test.mjs scripts/ci/__tests__/cleanup-source-retirement.test.mjs
- [ ] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh
