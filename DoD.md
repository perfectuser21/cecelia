- [x] 清退旧Harness故障演习CLI、每日Tick调度及专属测试，不新增退役占位守卫；正常Tick和蓝绿隔离继续通过。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/canary-no-tick.test.js src/__tests__/tick-consciousness-guard.test.js src/__tests__/consciousness-guard.test.js
- [x] 删除失效规划、旧baseline、重复evaluator和退役autoblock smoke，同步allow/write/sql清单，现役smoke安全合同通过。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs'
- [x] 混合Tick集成清掉退役演习接线和已删内容同步的旧mock/断言，其余正常意识开关和宿主副作用隔离在独立scratch数据库验收。
  Test: manual:npm exec -w packages/brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/consciousness-tick-runtime.integration.test.js
- [x] 固定候选源码CI通过后正常合并，事实/版本/DoD同步并回写任务，不部署生产。
  Test: manual:bash -c 'gh pr checks --repo perfectuser21/cecelia'
