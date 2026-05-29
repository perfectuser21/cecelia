---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: DB Migration — harness_messages 表

**范围**: 新建 `packages/brain/migrations/288_harness_messages.sql`，创建 `harness_messages` 表，供 WS6 的消息 API 端点使用
**大小**: S (~35 行，1 文件)
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/migrations/288_harness_messages.sql` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/migrations/288_harness_messages.sql')"

- [x] [ARTIFACT] migration 文件含 `CREATE TABLE IF NOT EXISTS harness_messages` 语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/288_harness_messages.sql','utf8'); if(!c.includes('CREATE TABLE') || !c.includes('harness_messages'))process.exit(1)"

- [x] [ARTIFACT] migration 含所有必填字段：id, initiative_id, sub_task_id, message, consumed_at, created_at
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/288_harness_messages.sql','utf8'); ['id','initiative_id','sub_task_id','message','consumed_at','created_at'].forEach(f=>{if(!c.includes(f)){console.error('FAIL: missing field '+f);process.exit(1)}})"

- [x] [ARTIFACT] migration 使用 `IF NOT EXISTS`（幂等）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/288_harness_messages.sql','utf8'); if(!c.includes('IF NOT EXISTS'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] migration 文件存在且包含完整 CREATE TABLE 语句
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/migrations/288_harness_messages.sql\",\"utf8\"); if(!c.includes(\"CREATE TABLE IF NOT EXISTS harness_messages\"))process.exit(1); console.log(\"OK\")" || { echo "FAIL: migration 文件缺 CREATE TABLE harness_messages"; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] harness_messages 表 schema 含六个必填字段（id/initiative_id/sub_task_id/message/consumed_at/created_at）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/migrations/288_harness_messages.sql\",\"utf8\"); const fields=[\"id\",\"initiative_id\",\"sub_task_id\",\"message\",\"consumed_at\",\"created_at\"]; fields.forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: missing field \"+f);process.exit(1)}}); console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] id 字段为 UUID 类型（Primary Key）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/migrations/288_harness_messages.sql\",\"utf8\"); if(!c.match(/id\s+UUID/i) && !c.match(/id\s+uuid/))process.exit(1); console.log(\"OK\")" || { echo "FAIL: id 字段非 UUID 类型"; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] error path — consumed_at 字段默认值为 NULL（可为空，消费前为 null）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/migrations/288_harness_messages.sql\",\"utf8\"); if(!c.includes(\"consumed_at\") || (!c.includes(\"DEFAULT NULL\") && !c.includes(\"TIMESTAMPTZ\")))process.exit(1); console.log(\"OK\")" || { echo "FAIL: consumed_at 字段配置不符合要求"; exit 1; }'
  期望: OK
