- [ ] 清退无生产上游的 spawn、host-executor 和 retry/spawn-pre 闭包；保留现役 provider、派发、任务配置和资源分类回归。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/claude-channel-retired.launchers.test.js src/__tests__/claude-channel-retired.executor.test.js src/__tests__/executor-route-override.test.js src/__tests__/goal-settings-serializer.test.js src/spawn/middleware/__tests__/resource-tier.test.js
- [ ] 清退旧 Docker writer 与专属中间件；保留混合测试中的真实回调、既有 PR 权限、任务状态和 fleet runner 隔离合同。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/existing-pr-authority.test.js src/__tests__/callback-utils-sync-resolver.test.js src/__tests__/executor-reattach.test.js src/__tests__/executor-contracts-docker-probe.test.js
- [ ] 真实隔离 PG 验证任务创建、现役回调及完成/失败终态，历史数据读路径不变。
  Test: manual:npm exec -w packages/brain -- vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/dev-task-lifecycle.e2e.test.js
- [ ] 删除三份旧 CORE-INV 包装与登记；保留现役合同分类、GAN 和发布回归。
  Test: manual:bash scripts/ci/__tests__/run-core-regression.test.sh
- [ ] smoke 安全分类、默认脚本、事实/版本/清单一致性通过；完整源码 CI 通过后正常合并并回写账本。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
