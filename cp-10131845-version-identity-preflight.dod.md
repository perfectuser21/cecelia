# 首批验收

- [x] [BEHAVIOR] versionidentitypreflight 四处复合身份外键、历史保护、漂移、缺列、幂等、DDL失败回滚、锁超时及生产拒写在真实PG验证。
  Test: manual:bash -c "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_scratch} DB_HOST=${DB_HOST:-/tmp} DB_USER=${DB_USER:-administrator} npx vitest run --config vitest.integration.config.js src/__tests__/integration/version-identity-preflight.pg.integration.test.js"
- [x] [BEHAVIOR] versionidentityreadonly 只读smoke检查真实结构、摘要和四处身份预检；生产不自动迁移。
  Test: manual:bash packages/brain/scripts/smoke/version-identity-preflight-smoke.sh
