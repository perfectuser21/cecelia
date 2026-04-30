# DoD — Feature Registry Brain DB

- [x] [ARTIFACT] migration 249_features_registry.sql 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/migrations/249_features_registry.sql')"

- [x] [ARTIFACT] src/routes/features.js 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/features.js')"

- [x] [ARTIFACT] seed-features.js 脚本存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/seed-features.js')"

- [x] [ARTIFACT] feature-registry-smoke.sh 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/smoke/feature-registry-smoke.sh')"

- [x] [BEHAVIOR] buildWhereClause 正确构建 WHERE 子句
  Test: packages/brain/src/__tests__/features-registry.test.js

- [x] [BEHAVIOR] GET /api/brain/features 返回 features 数组
  Test: packages/brain/src/__tests__/integration/features-registry.integration.test.js

- [x] [BEHAVIOR] PATCH /api/brain/features/:id 可更新 smoke_status 不影响其他字段
  Test: packages/brain/src/__tests__/integration/features-registry.integration.test.js

- [x] [BEHAVIOR] POST /seed 从 YAML 导入数据，不覆盖 smoke_status
  Test: packages/brain/src/__tests__/integration/features-registry.integration.test.js
