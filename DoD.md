# 发布锁竞争与构建缓存验收

Task: a04f2ac5-0ff2-42ae-8023-f0d130cbb2e9
GP-Anchor: none(infra)

- [ ] 真实shell→CLI→flock短竞争后同一次部署成功，同UUID与generation只增加一次，旧代码先复现红。
  Test: manual:node --test scripts/brain-image-retention-begin.test.mjs
- [ ] 持续锁忙有界失败，不偷锁、不写账、不执行构建或切换；永久错误和pending保护不变。
  Test: manual:node --test scripts/brain-image-retention-begin.test.mjs scripts/brain-image-retention.test.mjs scripts/brain-image-retention-ledger.test.mjs
- [ ] 只读结算、janitor及Docker后代持锁保护继续通过。
  Test: manual:node --test scripts/brain-image-retention-settlement.test.mjs scripts/brain-image-retention-engine.test.mjs scripts/brain-image-retention-docker.test.mjs
- [ ] 固定源码双SHA真实构建证明稳定工具层缓存复用，最终唯一GIT_SHA及成品工具/原生fixture验证，保留完整镜像保障。
  Test: manual:node scripts/ci/run-basic-check.mjs image
- [ ] Ops选择器永久发现新增锁回归，Scripts/版本/事实/DoD校验不放宽。
  Test: manual:node --test scripts/ci/__tests__/basic-ops-coverage.test.mjs
