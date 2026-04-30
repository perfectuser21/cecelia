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

- [x] [BEHAVIOR] real-env-smoke job 真起 cecelia-brain image（docker run + --network host）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/docker run -d --name cecelia-brain-smoke[\s\S]*?--network host/.test(c))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 等 brain healthy 后才跑 smoke（curl tick/status 90s 超时）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/curl -sf http:\/\/localhost:5221\/api\/brain\/tick\/status/.test(c))process.exit(1);if(!/seq 1 90/.test(c))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 跑 packages/brain/scripts/smoke/*.sh 全部，任一失败 → job fail
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('packages/brain/scripts/smoke'))process.exit(1);if(!/FAILED=[$][(][(]FAILED [+] 1[)][)]/.test(c))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 在 smoke 目录为空时 fail（强制必须有脚本）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/必须有至少 1 个 smoke 脚本/.test(c))process.exit(1)"

- [x] [BEHAVIOR] 示范 smoke 校验 tick/status HTTP 200 + 响应含 interval_minutes / loop_interval_ms / startup_ok
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/example-health-check.sh','utf8');if(!c.includes('interval_minutes'))process.exit(1);if(!c.includes('loop_interval_ms'))process.exit(1);if(!c.includes('startup_ok'))process.exit(1);if(!c.includes('HTTP_CODE'))process.exit(1)"

- [x] [BEHAVIOR] GET /api/brain/task-router/diagnose 返回 {status:'ok'}
      Test: packages/brain/src/routes/__tests__/task-router-diagnose-status.test.js

## Constraints

- 与 task A（cicd-A 改 /dev SKILL + lint job）不冲突：A 改 SKILL 文件 + lint job，B 改 ci.yml 主 job + 加 smoke 目录
- 不动 brain 业务代码（仅加 ci.yml job + 1 个 smoke 脚本）
- timeout 20 min（smoke 慢但准）
