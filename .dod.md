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

- [ ] 当前完整来源组与既有206/3a历史分别成立，未知控制、缺失、混配和已退入口复活不能获得当前来源资格。
  Test: manual:cd packages/brain && npx --no-install vitest run src/lib/__tests__/existing-ops-ci-residue-source.test.js
