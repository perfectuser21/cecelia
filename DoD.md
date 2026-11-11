# DoD：按现役功能精简PR CI

- [x] [BEHAVIOR] 旧API不再有独立矩阵或src构建，现役features全部在Dashboard任务按原API环境测试；旧服务不获现役测试资格。
  Test: manual:node --test scripts/ci/__tests__/basic-pr-functional-scope.test.mjs scripts/ci/__tests__/basic-api-features-lane.test.mjs
- [x] [BEHAVIOR] Ops按真实PR Git差异选域，核心Brain子集保留部署回滚保护，公共或未知输入保守全量；全量入口不丢新测试。
  Test: manual:node --test scripts/ci/__tests__/basic-ops-coverage.test.mjs scripts/ci/__tests__/basic-pr-functional-scope.test.mjs
- [x] [BEHAVIOR] 退役预览脚本、自造mock页面测试、旧API workers产物测试和重复facts检查删除；微信脚本真实拒绝/干跑/健康合同迁移保留。
  Test: manual:node --test scripts/ci/__tests__/basic-facts-authority.test.mjs scripts/ci/__tests__/basic-wechat-script-contract.test.mjs
- [x] [BEHAVIOR] 新完整来源组精准登记Dashboard features、拒绝旧API资格，Ops按实际选择；所有main历史组、混配/篡改/缺失拒绝与16成员marker0/1边界保持。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
