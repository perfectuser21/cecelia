# CodeQL附加发布清理验收

Task: 2238edc0-850a-434b-a3e2-c542e7536ad7
GP-Anchor: none(infra)

- [ ] 既有工作流契约先红后绿；只关闭附加数据库发布，语言/扫描/查询/SARIF/缓存/权限/触发保持。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs
- [ ] Scripts/Ops和现行门禁通过，不增加workflow或job；消费者经独立审查后显式续证。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] PR/main实际日志覆盖与告警/缓存上传成功，main无数据库打包/体积遥测；完整自动CD及生产业务读回成功。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
