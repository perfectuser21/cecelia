- [ ] 删除独立资源专项及专用计划/CLI，保留生产资源采样与真实fleet回归；CI汇总严格校验六父任务。
  Test: manual:node --test scripts/ci/__tests__/basic-results.test.mjs scripts/ci/__tests__/basic-workflow.test.mjs
- [ ] 来源证明只接受已审完整新旧cohort，拒绝篡改、缺失与单成员混配，隔离启动fixture带齐运行依赖。
  Test: manual:npm exec -w packages/brain -- vitest run src/lib/__tests__/existing-ops-current-ci-source.test.js src/lib/__tests__/existing-ops-parser-startup.test.js src/lib/__tests__/existing-ops-stage-source.test.js
- [ ] 预览无资源时不发成功评论，实际inactive回收和失败回执维持严格；成功文案不再虚报UI验收。
  Test: manual:node --test scripts/ci/__tests__/basic-preview-deploy.test.mjs
- [ ] runtime去掉重复mock调用，原行为测试仍由普通单测执行，真实PG接入合同不减。
  Test: manual:npm exec -w packages/brain -- vitest run src/node-onboarding/__tests__/service-completion-isolation.test.js
- [ ] 本地默认脚本、版本、事实和清单检查通过；完整固定HEAD源码CI成功后正常合并并回写账本。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
