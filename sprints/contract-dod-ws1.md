---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — initiative_run_events 表

**范围**: 新建 `initiative_run_events` 表 migration SQL 文件，含 initiative_id/node/status/attempt/verdict/ts 字段（**无 label 列**），ts 类型为 BIGINT，和 (initiative_id, ts) 复合索引
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/migrations/ 含 initiative_run_events migration 文件（含 CREATE TABLE）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>f.includes('initiative_run_events'));if(!files.length)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+files[0],'utf8');if(!c.includes('CREATE TABLE'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 (initiative_id, ts) 复合索引 CREATE INDEX
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>f.includes('initiative_run_events'));if(!files.length)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+files[0],'utf8');if(!c.includes('CREATE INDEX'))process.exit(1);if(!c.includes('initiative_id'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 status/verdict 列定义，ts 列类型为 BIGINT，无 label 列
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations').filter(f=>f.includes('initiative_run_events'));if(!files.length)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+files[0],'utf8');if(!c.includes('status'))process.exit(1);if(!c.includes('verdict'))process.exit(1);if(!c.match(/ts\s+BIGINT/i))process.exit(1);if(c.match(/\blabel\b/i))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] initiative_run_events 表存在，含 node/status/attempt/ts 列，**无 label 列**
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "node" && psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "status" && psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "attempt" && psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q " ts " && psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -v "status" | grep -qv "label" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] INSERT node_update 行（含 ts BIGINT Unix 秒）成功返回 id
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'aaaaaaaa-bbbb-cccc-dddd-ee0000000001'"'"', '"'"'proposer'"'"', '"'"'running'"'"', 1, extract(epoch from now())::bigint) RETURNING id" 2>&1 | grep -q "[0-9]" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] (initiative_id, ts) 复合索引存在于 pg_indexes
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -t -c "SELECT indexname FROM pg_indexes WHERE tablename='"'"'initiative_run_events'"'"'" 2>&1 | grep -q "initiative_run_events" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] INSERT run_completed 行（status=run_completed, verdict=PASS）成功，可存 PASS 值
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, verdict, ts) VALUES ('"'"'aaaaaaaa-bbbb-cccc-dddd-ee0000000002'"'"', '"'"'report'"'"', '"'"'run_completed'"'"', 1, '"'"'PASS'"'"', extract(epoch from now())::bigint) RETURNING id, verdict" 2>&1 | grep -q "PASS" && echo OK'
  期望: OK
