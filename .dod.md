- [ ] 93份烟测追溯业务入口与建立目的后，86份清退、7份保留；分类/写目标/SQL登记及无现役调用的历史E2E消费者同步清理，安全断言迁移后不丢失。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs scripts/ci/__tests__/basic-task-static-readers.test.mjs'
- [ ] 实际V2公网权限/脱敏/限流、回调curl目的地址/退出码、真实JOBS委托与Notion正文隔离由当前行为测试验证，未改业务实现。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/acceptance-public-server.test.js src/__tests__/callback-url-behavior.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/notion-push-sync.test.js
- [ ] 五份私有schemaPG回归实际执行，并进入原PR集成job；需要私有owner的capture仍由独立私有PG入口承接，不混入普通PG连接。
  Test: manual:node --test scripts/ci/__tests__/basic-current-pg-gate.test.mjs
- [ ] 凭据恢复/保活/预览/体外哨兵仅在隔离CLI替身运行；Ops实际发现新增fixture，不用固定历史数量判断覆盖。
  Test: manual:node --test scripts/ci/__tests__/basic-ops-coverage.test.mjs
- [ ] 事实、版本、DoD及默认scripts通过；独立复审、完整CI和正常PR合并后回写任务并清理本轮资源。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
