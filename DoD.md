- [x] 删除6份旧有头Relay专属静态合同与对应6份包装脚本，保留共享建单白名单smoke及现役有头开发保护。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] 旧Sprint测试毕业工具保留原行为，通用smoke登记与安全检查保持有效。
  Test: manual:npm exec -- vitest run tests/graduate-sprint-tests.test.ts
- [ ] PR源码检查及汇总门通过后合并，任务回写并清理本次工作树。
  Test: manual:bash -c 'gh pr checks --repo perfectuser21/cecelia'
