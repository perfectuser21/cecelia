# DoD：退役旧CI工具与冗余检查

- [x] [BEHAVIOR] 月归档与合并后旧流程文档清理的脚本、专属测试及当前入口退役，预览资源回收保持现役合同。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] [BEHAVIOR] 旧Implementation工作流壳、Engine/Quality历史接受矩阵、Kernel baseline和旧文档/YAML非空检查退出默认PR；当前来源和权限拒绝回归保留。
  Test: manual:node --test scripts/ci/__tests__/run-basic-check.test.mjs scripts/ci/__tests__/basic-ci-admission-authority.test.mjs
- [x] [BEHAVIOR] 重复执行及Ops冗余移除，部署固定SHA、凭据隔离、退出码和回滚实际行为仍受保护。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [x] [BEHAVIOR] 旧API按真实消费者拆除，现役共享features、Dashboard和captures数据合同保留。
  Test: manual:node scripts/ci/run-basic-check.mjs dashboard
- [ ] [BEHAVIOR] 内容弱测试和无调用残留退出；按主理人本轮范围保留现役内容接口，受保护PR通过且合并。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
