# 默认CI剩余死分支与重复执行清理

Task: 0e08424b-4724-48d3-82c9-058e44f732ce
GP-Anchor: none(infra)

- [ ] Codex/Grok账号派发保留，Claude不可达命令和OAuth读取分支清退，旧平台拒绝且不访问文件或网络。
  Test: manual:node --test scripts/dispatch-worker.test.mjs
- [ ] 租约与设备锁的真实PG合同保留，无现役派发消费者的旧选台入口及专属断言成组清退。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/task-lease-device-pool.pg.integration.test.js
- [ ] 夜间汇总及其导入叶不重复执行，PR固定合同继续收集，自动覆盖清单准确反映真实导入保障。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-test-debt.test.mjs
  Test: manual:node --test scripts/ci/__tests__/basic-integration-once.test.mjs
- [ ] 无工作流消费者的旧Skill身份复合动作和n8n能力映射清退，现役构建源恢复与Skill真身所有权仍有效。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts

- [ ] 仅清除旧Tick的孤立KR/Harness巡检与重复会话整理接线，现役调度和独立会话整理保持，剩余Tick合同继续执行。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/tick-runner-full-tick.integration.test.js src/__tests__/integration/consciousness-tick-runtime.integration.test.js

- [ ] 旧factory新采集入口返回410且不触发token、网络或数据库写入；历史唯一快照可读，歧义保持拒绝，不猜测最新版本。
  Test: manual:cd packages/brain && npx --no-install vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/native-consumer-source-selection.pg.integration.test.js
- [ ] 保留Foundation/ZenithJoy共享快照与固定发布产物读回、Infra现役登记、consumer evidence不可执行边界；启动与通用CLI不再依赖已退来源收集器。
  Test: manual:cd packages/brain && npx --no-install vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/infra-consumer-source.pg.integration.test.js
  Test: manual:node --test scripts/ci/__tests__/implementation-factory-retirement.test.mjs
- [ ] 旧来源图模板与豁免清退，保留实际Claude通道禁用守卫与共享source_set合同。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/claude-channel-retired.guard.test.js src/lib/__tests__/workspace-ci-source-bundle.test.js src/lib/__tests__/consumer-source-set.test.js
