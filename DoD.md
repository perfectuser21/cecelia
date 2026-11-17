- [ ] 在cecelia_scratch隔离schema以现役17列表调用真实裁决HTTP入口；无分类API三格可定案并持久化，不新增数据库列。
  Test: manual:cd packages/brain && DB_NAME=cecelia_scratch npx --no-install vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/acceptance-classification.pg.integration.test.js
- [ ] 从已有detail.scenario_class和detail.hard读取；缺失/null保持未知，布尔hard与trace分类执行原规则，错误类型失败并回滚。
  Test: manual:cd packages/brain && DB_NAME=cecelia_scratch npx --no-install vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/acceptance-classification.pg.integration.test.js
- [ ] 回归接入必需brain-integration门；Brain版本同步，不修改迁移或生产schema，不发布镜像。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
