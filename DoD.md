- [ ] 按441份全量审计清退33份失效及28份重复包装，登记、写目标、SQL目标和动态fixture引用同步；保留247份和133份证据不足项。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs scripts/ci/__tests__/basic-task-static-readers.test.mjs'
- [ ] 安全测试fixture缺失被测脚本时必须失败，不将shell未执行当作安全拒绝；原生产目标/授权边界用例仍实际执行。
  Test: manual:node --test packages/brain/scripts/smoke/__tests__/smoke-production-guard.node-test.mjs
- [ ] 两个保留资源/工作区wrapper移除失效旧委托，真实现役suite集合与退出17阻断行为保持。
  Test: manual:node --test packages/brain/scripts/smoke/__tests__/smoke-delegate-targets.node-test.mjs
- [ ] 活跃资源保护、派发/终态/回调/Notion与授权隔离回归保留，未改业务源码或生产设置。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/task-terminal.test.js src/__tests__/notion-push-sync.test.js src/__tests__/dispatcher-hol.test.js
- [ ] 固定候选通过默认脚本与事实/版本/清单门禁，独立复审后正常PR、CI成功合并、任务与资源收尾。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
