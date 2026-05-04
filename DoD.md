# DoD — Brain Migration 259 冲突修复

task_id: c8638840-0989-41c0-a502-ecea32c4e49b

## 验收条目

- [x] [ARTIFACT] `packages/brain/migrations/260_license_system.sql` 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/migrations/260_license_system.sql')"

- [x] [ARTIFACT] `packages/brain/migrations/259_license_system.sql` 已删除
  Test: manual:node -e "try{require('fs').accessSync('packages/brain/migrations/259_license_system.sql');process.exit(1)}catch(e){}"

- [x] [BEHAVIOR] selfcheck.js EXPECTED_SCHEMA_VERSION 为 260
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8'); if(!c.includes(\"'260'\")) process.exit(1)"

- [x] [BEHAVIOR] DEFINITION.md schema_version 更新为 260
  Test: manual:node -e "const c=require('fs').readFileSync('DEFINITION.md','utf8'); if(!c.includes('Schema 版本: 260')) process.exit(1)"
