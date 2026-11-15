- [ ] 清退10份引用退役模块的烟测及15份重复源码字面包装，保留真实业务模块和行为回归；同步全部25登记。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs scripts/ci/__tests__/basic-task-static-readers.test.mjs'
- [ ] 任务结果补写、HTTP联动、staging、机群资源、决策去重、磁盘保护和Notion回归保留有效。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/capture-triage.test.js src/__tests__/decision-dedup.test.js src/cron/disk-guard.test.js src/__tests__/notion-push-sync.test.js
- [ ] 夜间Commander审计使用独占新建scratch与明确TEST_DB_URL，创建失败不能进入回归，原数据库环境保持。
  Test: manual:node --test scripts/ci/__tests__/basic-nightly-consolidation.test.mjs
- [ ] 实际深回归配置在空的专用scratch执行12项Commander审计且不跳过，保留进程恢复与副作用边界。
  Test: manual:npm exec -w packages/brain -- vitest run --config ../../scripts/ci/deep-integration.config.mjs src/orchestrator/__tests__/commander-foundation-audit.pg.integration.test.js
- [ ] 当前固定候选脚本检查、事实、版本和清单检查通过，源码CI成功后正常合并并回写账本。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
