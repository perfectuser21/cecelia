# DoD：旧Harness现役入口与实现清退

- [x] [BEHAVIOR] 有头开发记账用dev且不会被自动领取；无头开发仍由coding-workflow-runner处理。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs
- [x] [BEHAVIOR] 旧Harness不能新建或执行，旧启动/恢复/流程/报表及无对象测试物理清退，历史数据库行保留。
  Test: manual:node scripts/facts-check.mjs
- [x] [BEHAVIOR] 通用回调、任务归属、真实合并终态、Runner和现役staging保护仍有效。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] [BEHAVIOR] 来源与只读封组完整、历史组不变、未知及混配不放行；版本同步。
  Test: manual:bash scripts/check-version-sync.sh
- [ ] [BEHAVIOR] 完整PR验收通过并真实合并，Task事实证据actor准确读回。
  Test: manual:curl -sf http://localhost:5221/api/brain/tasks/daf21af7-d3b5-48e5-82d0-b6c097e3c072
