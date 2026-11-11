# DoD：四个工作流全部 Job 价值精简

- [x] [BEHAVIOR] 主CI由16个定义收敛为11个，容器3组与真实PG2组共用准备，首组失败不吞后组，独立镜像和实际断言保留。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-resource-canary.test.mjs scripts/ci/__tests__/basic-results.test.mjs
- [x] [BEHAVIOR] Skill四cell覆盖两份Linux合同与三OS恢复，删重复Linux恢复和单独汇总；唯一最终门拒绝失败、取消、跳过、缺失。
  Test: manual:node --test scripts/ci/__tests__/basic-skill-source-coverage.test.mjs scripts/ci/__tests__/basic-brain-test-debt.test.mjs
- [x] [BEHAVIOR] 旧Express API真实PG仅保留手动兼容入口，不再生成强制矩阵；共享前端单测与构建继续实际执行。
  Test: manual:node --test scripts/ci/__tests__/basic-scope.test.mjs scripts/ci/__tests__/basic-runtime-consumer-scope.test.mjs scripts/ci/__tests__/run-basic-check.test.mjs
- [x] [BEHAVIOR] Nightly删无使用证据的分类诊断job，保留CLI与真实失败传播；两个PG安全测试补真实task_runs夹具且原安全断言全过。
  Test: manual:node --test scripts/ci/__tests__/basic-nightly-consolidation.test.mjs
  Test: manual:node scripts/ci/run-debt-pg.mjs --file packages/brain/src/__tests__/integration/codex-slot-accounting.pg.integration.test.js --file packages/brain/src/__tests__/integration/retired-registry-manual-race.pg.integration.test.js --native-bin /opt/homebrew/opt/postgresql@17/bin
- [x] [BEHAVIOR] Sentinel保留独立只读probe，告警和恢复互斥并入reconcile；Issue失败仍尝试Bark、坏回执与缺凭据失败、仅双绿关闭。
  Test: manual:node --test scripts/ci/__tests__/basic-alert-failure-propagation.test.mjs
- [x] [BEHAVIOR] 新CI和Nightly仅按完整已审来源接受，旧历史完整组保留；缺失、篡改与跨组混配拒绝，16成员marker0/1边界保持。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js src/lib/__tests__/existing-ops-w19-freeze-cohort.test.js
