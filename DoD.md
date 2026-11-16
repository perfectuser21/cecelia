- [ ] 删除无实际调用方、无计划生成或部署实现的独立Workflow注册YAML；唯一PR CI及夜间/监控入口保持。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs
- [ ] 保留主CI真实执行的发布、注册与恢复验收；发布脚本继续验证已安装固定字节、目标机、发布资格、部署gate及目录，不创建业务任务。
  Test: manual:npm exec -w packages/brain -- vitest run scripts/commander-workflow/__tests__/foundation-publish.test.mjs
- [ ] 调用方盘点包含业务仓main和开放PR实际文件；源码门与正常PR CI通过后合并，任务留痕并清理本轮资源。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
