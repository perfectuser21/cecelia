# 现役业务CI/CD回归修复

Task: ad48434f-e2d5-4464-8c60-034ef11b7665
GP-Anchor: none(infra)

- [ ] 现役runScheduler在无KR时仅派发原生Notion任务，保留停止、可信资源、宿主容量和设备锁，普通AI任务不能超额。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/tick-scheduler.test.js src/__tests__/dispatcher-qiumi-pool-gate-bypass.test.js
- [ ] 原生任务经正式调度入口、真实数据库及原生worker执行并保留唯一TaskRun和产物，回归进入必需CI。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [ ] Notion和在途Commander业务失败传至调度哨兵及运行账，活性继续如实报告，单job失败不阻止其它job。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/scheduler-jobs-results.test.js src/__tests__/scheduler-jobs-gtd-sync.test.js src/lib/__tests__/workflow-commander-result.test.js
- [ ] 完成回调进度记录与Task完成同事务提交，进度写失败不导致自锁或丢失原始执行回执；夜间真实PG合同恢复。
  Test: manual:node scripts/ci/run-debt-pg.mjs
- [ ] 候选镜像固定业务合同验证Task、TaskRun、文件产物与进程停止；成功收据SHA不符或证据缺失时拒绝准入。
  Test: manual:node --test scripts/ci/__tests__/basic-release-business-gate.test.mjs
- [ ] 现役sidecar固定只读验收失败时不报告成功，不隐式回滚生产数据库或外部效果。
  Test: manual:node --test scripts/bluegreen-sidecar-completion.test.mjs
