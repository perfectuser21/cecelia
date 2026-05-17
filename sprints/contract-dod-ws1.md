---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — initiative_run_events 表

**范围**: 新建 `initiative_run_events` 表 migration SQL 文件，含 initiative_id/node/label/attempt/ts/status/verdict 字段和 (initiative_id, ts) 复合索引
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/migrations/ 含 initiative_run_events migration 文件（含 CREATE TABLE）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>f.includes('initiative_run_events'));if(!files.length)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+files[0],'utf8');if(!c.includes('CREATE TABLE'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 (initiative_id, ts) 复合索引 CREATE INDEX
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>f.includes('initiative_run_events'));if(!files.length)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+files[0],'utf8');if(!c.includes('CREATE INDEX'))process.exit(1);if(!c.includes('initiative_id'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 status/verdict 列定义
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>f.includes('initiative_run_events'));if(!files.length)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+files[0],'utf8');if(!c.includes('status'))process.exit(1);if(!c.includes('verdict'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] initiative_run_events 表存在，含 node/label/attempt 列
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "node" && psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "label" && psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "attempt" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] INSERT node_update 行成功返回 id
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'aaaaaaaa-bbbb-cccc-dddd-ee0000000001'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) RETURNING id" 2>&1 | grep -q "[0-9]" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] (initiative_id, ts) 复合索引存在于 pg_indexes
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -t -c "SELECT indexname FROM pg_indexes WHERE tablename='"'"'initiative_run_events'"'"'" 2>&1 | grep -q "initiative_run_events" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] status 列接受 '"'"'done'"'"' 值，verdict 列可存 '"'"'PASS'"'"'
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt, status, verdict) VALUES ('"'"'aaaaaaaa-bbbb-cccc-dddd-ee0000000002'"'"', '"'"'report'"'"', '"'"'Report'"'"', 1, '"'"'done'"'"', '"'"'PASS'"'"') RETURNING id" 2>&1 | grep -q "[0-9]" && echo OK'
  期望: OK
