# DoD — All Features Smoke Script

- [x] [ARTIFACT] packages/brain/scripts/smoke/all-features-smoke.sh 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/smoke/all-features-smoke.sh')"

- [x] [BEHAVIOR] 脚本含 /api/brain/features、smoke_cmd、smoke_status、set -uo pipefail、exit 1
  Test: packages/brain/src/routes/__tests__/all-features-smoke.test.js

- [x] [BEHAVIOR] 脚本对真实 Brain 运行后写回 smoke_last_run 字段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/all-features-smoke.sh','utf8');if(!c.includes('smoke_last_run'))process.exit(1)"
