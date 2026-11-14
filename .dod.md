- [x] 删除Cecelia内容业务的后端、自动调度与页面接线，保留外部工作单挂号、通用任务、运行检查日报和历史数据。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] 删除动态模型管理功能，只读运行时参数不改变当前API调用语义。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/model-profile.test.js src/__tests__/model-profile-dispatch.test.js src/__tests__/model-profile-rumination.test.js
- [x] 外部任务认领与回执按owner和原生epoch校验；失约和旧回执不得覆盖现行任务。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/integration/external-worker-lease-finish.pg.integration.test.js src/__tests__/integration/external-worker-lease-reaper.pg.integration.test.js
- [x] 混合模块、UI和CI来源合同验证通过，无悬空导入或清单条目。
  Test: manual:npm exec -w apps/api -- vitest run
- [ ] 准确候选提交的源码CI通过后合并，任务回写并清理本次工作树。
  Test: manual:bash -c 'gh pr checks --repo perfectuser21/cecelia'
